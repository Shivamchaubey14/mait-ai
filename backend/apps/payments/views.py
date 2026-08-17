"""
Payment endpoints (SRS §6.5, §9.7).

Keyed by the AI event rather than by a payment id, because that is what the app has in its
hand and because one event has exactly one payment. The Mait never sees a payment id.

**Two farmers, two shapes.** A member hands over nothing: the dairy deducts the charge from
her milk payment, so the payment is recorded and verified in one call and there is nothing to
authorise. A non-member pays the Mait on the spot, and that is where the authorisation code
matters — it is the only thing standing between a Mait and a payment the farmer never made.

The amount is never taken from the request. It is read off the breed the straw came from,
where the administrator set it (``pricing.price_for``), because a handset that could name the
price could name a different one for every farmer.
"""

from __future__ import annotations

from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.ai_events.models import AIEvent
from apps.ai_events.serializers import AIEventSerializer
from apps.core.exceptions import DomainError
from apps.core.models import AuditLog
from apps.core.permissions import IsMait
from apps.core.services import record_audit
from apps.core.storage import store_image

from .models import OTPLog, Payment
from .pricing import price_for
from .serializers import (
    PaymentInitiateSerializer,
    PaymentOTPSerializer,
    PaymentProofSerializer,
    PaymentSerializer,
)
from .services import finalise_payment, initiate_payment, verify_otp


class _EventScoped(APIView):
    """Everything here acts on one of the requesting Mait's own events (SRS §16)."""

    permission_classes = [IsMait]

    def event(self, request, ai_event_id: int) -> AIEvent:
        mait = getattr(request.user, "mait_profile", None)
        return get_object_or_404(
            AIEvent.objects.select_related("animal", "semen_batch", "member", "non_member"),
            pk=ai_event_id,
            mait=mait,
        )

    @staticmethod
    def amount_for(event: AIEvent):
        breed = getattr(event.semen_batch, "breed", "") if event.semen_batch_id else ""
        amount = price_for(
            breed=breed,
            animal_type=event.animal.animal_type,
            owner_type=event.owner_type,
        )
        if amount is None:
            raise DomainError(
                "This breed has no rate set for this kind of farmer. Ask the administrator "
                "to price it before collecting anything."
            )
        return amount


@extend_schema(tags=["payments"])
class PaymentInitiateView(_EventScoped):
    """Record how this insemination is being paid for (SRS §6.5 step 1)."""

    @extend_schema(
        summary="Record the payment for an AI event",
        description=(
            "A **member** pays nothing here: the charge is recorded as a deduction against "
            "her milk payment and verified immediately, because nobody is being asked for "
            "money and there is nothing to authorise.\n\n"
            "A **non-member** pays the Mait, so `mode` is required — `COD` for cash or "
            "`ONLINE` for UPI — and an authorisation code goes to her own number.\n\n"
            "The amount is the administrator's, read off the breed of the straw used. It is "
            "never taken from the request."
        ),
        request=PaymentInitiateSerializer,
        responses={200: PaymentSerializer},
    )
    def post(self, request, ai_event_id: int):
        event = self.event(request, ai_event_id)
        serializer = PaymentInitiateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        amount = self.amount_for(event)

        if event.owner_type == AIEvent.OwnerType.MEMBER:
            payment = self._record_deduction(event, amount, request)
        else:
            mode = serializer.validated_data.get("mode")
            if not mode:
                return Response(
                    {"detail": "Say how she is paying: COD or ONLINE."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            payment = initiate_payment(ai_event=event, mode=mode, amount=amount, actor=request.user)

        return Response(PaymentSerializer(payment).data)

    def _record_deduction(self, event: AIEvent, amount, request) -> Payment:
        """
        The member case, start to finish in one call.

        **This platform never moves a member's money.** The deduction itself is made by the
        finance department, in their own software, against the milk payout. Nothing here calls
        a gateway, asks her to authorise anything, or waits on a settlement — the row exists so
        finance has something to reconcile against, and so the AI event has the verified
        payment its completion requires.

        That is why it is written `VERIFIED` on creation. There is no state to move through:
        she owes the dairy, the dairy owes her more, and the two are settled at the payout. A
        pending status here would be this app claiming to be waiting for something it is not
        party to, and it would hold the capture open forever.
        """
        from apps.ai_events.services import mark_payment_pending

        payment, created = Payment.objects.get_or_create(
            ai_event=event,
            defaults={
                "mode": Payment.Mode.DEDUCTION,
                "amount": amount,
                "status": Payment.Status.VERIFIED,
            },
        )
        if not created and not payment.is_verified:
            payment.mode = Payment.Mode.DEDUCTION
            payment.amount = amount
            payment.status = Payment.Status.VERIFIED
            payment.save(update_fields=["mode", "amount", "status", "updated_at"])

        if event.can_transition_to(AIEvent.Status.PAYMENT_PENDING):
            mark_payment_pending(event, actor=request.user)

        record_audit(
            action=AuditLog.Action.CREATE,
            entity_type="payment",
            entity_id=payment.id,
            request=request,
            meta={"mode": Payment.Mode.DEDUCTION, "amount": str(amount)},
        )
        return payment


@extend_schema(tags=["payments"])
class PaymentOTPVerifyView(_EventScoped):
    """The farmer's authorisation code for a payment she is making (SRS §6.5.1)."""

    @extend_schema(
        summary="Verify the payment authorisation code",
        request=PaymentOTPSerializer,
        responses={200: PaymentSerializer},
    )
    def post(self, request, ai_event_id: int):
        event = self.event(request, ai_event_id)
        payment = get_object_or_404(Payment, ai_event=event)
        serializer = PaymentOTPSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # Already authorised: say so rather than trying to spend the code a second time.
        #
        # A verified OTP is consumed, so a repeat lookup finds nothing pending and the honest
        # answer from `verify_otp` is "no OTP is pending" — which the app could only render as
        # the code being wrong. It was not wrong; it had already been accepted. A Mait whose
        # first tap authorised the payment and then hit a refusal further down the line taps
        # again, is told her code is bad, and asks a farmer to read out a number that will
        # never work now. Idempotent instead, which is what a retried tap deserves.
        if payment.is_verified:
            return Response(PaymentSerializer(payment).data)

        purpose = (
            OTPLog.Purpose.PAYMENT_ONLINE
            if payment.mode == Payment.Mode.ONLINE
            else OTPLog.Purpose.PAYMENT_COD
        )
        verify_otp(
            mobile_no=getattr(event.owner, "mobile_no", ""),
            purpose=purpose,
            code=serializer.validated_data["otp"],
        )

        payment.member_otp_verified = True
        payment.save(update_fields=["member_otp_verified", "updated_at"])

        # Cash needs nothing else, so the code that authorised it also completes it.
        if payment.mode == Payment.Mode.COD:
            payment.cod_otp_verified = True
            payment.save(update_fields=["cod_otp_verified", "updated_at"])
            payment = finalise_payment(payment, actor=request.user)

        return Response(PaymentSerializer(payment).data)


@extend_schema(tags=["payments"])
class PaymentProofView(_EventScoped):
    """The UTR and the screenshot behind an online payment (SRS §6.5.4)."""

    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(
        summary="Attach proof of an online payment",
        request=PaymentProofSerializer,
        responses={200: PaymentSerializer},
    )
    def post(self, request, ai_event_id: int):
        event = self.event(request, ai_event_id)
        payment = get_object_or_404(Payment, ai_event=event)
        serializer = PaymentProofSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        payment.utr_number = serializer.validated_data["utr_number"].strip()
        payment.payment_screenshot_url = store_image(
            serializer.validated_data["screenshot"],
            prefix="payment-proofs",
            key=payment.id,
            when=payment.created_at,
        )
        payment.save(update_fields=["utr_number", "payment_screenshot_url", "updated_at"])

        if payment.requirements_met:
            payment = finalise_payment(payment, actor=request.user)

        return Response(PaymentSerializer(payment).data)


@extend_schema(tags=["payments"])
class PaymentDetailView(_EventScoped):
    """Where a payment has got to, for a screen the Mait comes back to."""

    @extend_schema(summary="Payment detail", responses={200: PaymentSerializer})
    def get(self, request, ai_event_id: int):
        event = self.event(request, ai_event_id)
        payment = getattr(event, "payment", None)
        if payment is None:
            return Response(
                {"detail": "No payment has been recorded for this event yet."},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(PaymentSerializer(payment).data)


@extend_schema(tags=["payments"])
class PaymentAmountView(_EventScoped):
    """What this insemination costs, before anything is recorded."""

    @extend_schema(
        summary="The amount due for an AI event",
        description=(
            "Read off the breed of the straw used, at the rate the administrator set for "
            "this kind of farmer. Members and non-members are priced separately."
        ),
        responses={200: AIEventSerializer},
    )
    def get(self, request, ai_event_id: int):
        return Response(AIEventSerializer(self.event(request, ai_event_id)).data)
