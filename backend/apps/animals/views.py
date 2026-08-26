"""Animal registry and breed configuration endpoints (SRS §9.4)."""

from __future__ import annotations

from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from apps.accounts.models import PortalSection
from apps.core.exceptions import RecordInUse
from apps.core.models import AuditLog
from apps.core.permissions import IsAdmin, IsAdminOrMaitReadOnly, IsMait, in_section
from apps.core.services import record_audit

from .models import Animal, BreedConfig
from .queries import with_ai_history
from .serializers import (
    AnimalCreateSerializer,
    AnimalPhotoSerializer,
    AnimalSerializer,
    AnimalUpdateSerializer,
    BreedConfigSerializer,
    BreedConfigWriteSerializer,
)
from .storage import store_animal_photo


@extend_schema(tags=["animals"])
class BreedAdminViewSet(viewsets.ModelViewSet):
    """
    Maintain the semen list — the breeds a Mait can be issued and can ask for.

    The straw half of the catalogue. Straws themselves are not rows an admin types: they
    arrive by being issued against an indent, either by number or as a bundle of one of these
    breeds. What is maintained here is the list itself, its labels in both languages, and the
    rate per straw.

    Full CRUD, with one guard on delete: a breed already carried by an animal, a straw or an
    indent cannot be removed, because all three reference it by code and none of them keeps a
    copy of the name. Retiring takes it off the app and leaves those records legible.
    """

    serializer_class = BreedConfigWriteSerializer
    # Products maintains the list; Rates reads it to price each breed's straw, so an admin
    # given one of the two screens must not be refused the catalogue behind it.
    permission_classes = [IsAdmin, in_section(PortalSection.PRODUCTS, PortalSection.RATES)]
    queryset = BreedConfig.objects.all().order_by("animal_type", "display_order", "name")
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["animal_type", "is_active"]
    pagination_class = None

    def perform_destroy(self, instance):
        from apps.indents.models import IndentRequest
        from apps.inventory.models import SemenBatch

        referenced = (
            Animal.objects.filter(breed=instance.code).exists()
            or SemenBatch.objects.filter(breed=instance.code).exists()
            or IndentRequest.objects.filter(breed=instance.code).exists()
        )
        if referenced:
            raise RecordInUse(
                f"{instance.name} is already on an animal, a straw or an indent, so it "
                "cannot be deleted. Retire it instead — it disappears from the app and the "
                "existing records keep their name."
            )
        instance.delete()


@extend_schema(tags=["animals"])
class BreedConfigViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """
    The breed list, driven by configuration rather than code (SRS §6.3 step 3).

    A table rather than an enum because the authoritative list is still an open item
    (SRS §18.2 item 1) and must be changeable without a deploy.
    """

    serializer_class = BreedConfigSerializer
    permission_classes = [IsAdminOrMaitReadOnly]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["animal_type"]
    pagination_class = None  # a couple of dozen rows the app caches whole for offline use

    def get_queryset(self):
        return BreedConfig.objects.filter(is_active=True)

    @extend_schema(
        summary="Breed options by animal type",
        # Kept on the read endpoint deliberately: the app caches this whole list offline, so
        # a retired breed must disappear from it rather than arrive flagged.
        description=(
            "Filter with `?animal_type=COW` or `BUFF`. The app pulls the whole list at login "
            "and caches it, so the picker keeps working with no signal (SRS §6.3.2)."
        ),
        parameters=[
            OpenApiParameter("animal_type", description="COW or BUFF", required=False, type=str)
        ],
    )
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)


@extend_schema(tags=["animals"])
class AnimalViewSet(
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Animals belonging to members and non-members at this Mait's MPPs (SRS §9.4)."""

    permission_classes = [IsMait]
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        """
        Scoped to the requesting Mait's own MPPs.

        An animal is reachable through either owner, so both sides of the nullable pair are
        filtered — omitting one would leak every non-member's animals to every Mait.
        """
        mait = getattr(self.request.user, "mait_profile", None)
        if mait is None:
            return Animal.objects.none()
        return with_ai_history(
            (
                Animal.objects.filter(member__mpp__mait=mait)
                | Animal.objects.filter(non_member__mpp__mait=mait)
            ).select_related("member", "non_member")
        )

    def get_serializer_class(self):
        if self.action == "create":
            return AnimalCreateSerializer
        if self.action in ("update", "partial_update"):
            return AnimalUpdateSerializer
        return AnimalSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["mait"] = getattr(self.request.user, "mait_profile", None)
        return context

    @extend_schema(
        summary="Register an animal",
        description=(
            "Belongs to exactly one of a member or a non-member. The ear tag is optional but "
            "unique across the platform when given, so a tag that already exists is rejected "
            "with the clash named rather than silently accepted."
        ),
        request=AnimalCreateSerializer,
        responses={201: AnimalSerializer},
    )
    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        animal = serializer.save()

        record_audit(
            action=AuditLog.Action.CREATE,
            entity_type="animal",
            entity_id=animal.id,
            request=request,
            meta={"animal_type": animal.animal_type, "breed": animal.breed},
        )
        return Response(AnimalSerializer(animal).data, status=status.HTTP_201_CREATED)

    @extend_schema(
        summary="Attach her portrait",
        description=(
            "Multipart: `photo`. Taken when the animal is registered, so the Mait recognises "
            "her on the next visit — most animals here carry no ear tag.\n\n"
            "Separate from registration rather than part of it: the animal must exist even "
            "if the upload fails, because the capture flow is standing on her id and a "
            "village connection is the least reliable thing in it."
        ),
        request=AnimalPhotoSerializer,
        responses={200: AnimalSerializer},
    )
    @action(detail=True, methods=["patch"], parser_classes=[MultiPartParser, FormParser])
    def photo(self, request, pk=None):
        animal = self.get_object()

        serializer = AnimalPhotoSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # Outside any transaction: the upload takes as long as the village connection takes.
        animal.photo_url = store_animal_photo(animal, serializer.validated_data["photo"])
        animal.save(update_fields=["photo_url", "updated_at"])

        record_audit(
            action=AuditLog.Action.UPDATE,
            entity_type="animal",
            entity_id=animal.id,
            request=request,
            meta={"photo": True},
        )
        return Response(AnimalSerializer(animal).data)

    @extend_schema(
        summary="Correct a breed or add an ear tag",
        request=AnimalUpdateSerializer,
        responses={200: AnimalSerializer},
    )
    def partial_update(self, request, *args, **kwargs):
        animal = self.get_object()
        before = {"breed": animal.breed, "ear_tag_no": animal.ear_tag_no}

        serializer = AnimalUpdateSerializer(animal, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        animal = serializer.save()

        record_audit(
            action=AuditLog.Action.UPDATE,
            entity_type="animal",
            entity_id=animal.id,
            request=request,
            meta={
                "before": before,
                "after": {"breed": animal.breed, "ear_tag_no": animal.ear_tag_no},
            },
        )
        return Response(AnimalSerializer(animal).data)
