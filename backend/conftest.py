"""Shared pytest fixtures and factories."""

from __future__ import annotations

import uuid
from decimal import Decimal

import factory
import pytest
from django.utils import timezone

from apps.accounts.models import Role, User
from apps.ai_events.models import AIEvent
from apps.animals.models import Animal, AnimalType
from apps.inventory.models import MaitInventory, ProductType, SemenBatch
from apps.masterdata.models import Mait, Member, MPP
from apps.payments.models import Payment


# --------------------------------------------------------------------------------------
# Factories
# --------------------------------------------------------------------------------------
class UserFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = User

    username = factory.Sequence(lambda n: f"user{n}")
    full_name = factory.Faker("name")
    role = Role.MAIT
    mobile_no = factory.Sequence(lambda n: f"98765{n:05d}")


class MaitFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Mait

    sahayak_vendor_code = factory.Sequence(lambda n: f"SAH{n:06d}")
    name = factory.Faker("name")
    mobile_no = factory.Sequence(lambda n: f"98760{n:05d}")
    user = factory.SubFactory(UserFactory)


class MPPFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = MPP

    mpp_code = factory.Sequence(lambda n: f"MPP{n:06d}")
    mpp_name = factory.Faker("city")
    district_code = "D001"
    mait = factory.SubFactory(MaitFactory)


class MemberFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Member

    member_code = factory.Sequence(lambda n: f"MEM{n:08d}")
    member_name = factory.Faker("name")
    mobile_no = factory.Sequence(lambda n: f"98770{n:05d}")
    mpp = factory.SubFactory(MPPFactory)


class AnimalFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Animal

    owner_type = Animal.OwnerType.MEMBER
    member = factory.SubFactory(MemberFactory)
    animal_type = AnimalType.COW
    breed = "GIR"


class SemenBatchFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = SemenBatch

    unique_straw_no = factory.Sequence(lambda n: f"STRAW{n:08d}")
    breed = "GIR"
    received_date = factory.LazyFunction(timezone.localdate)


# --------------------------------------------------------------------------------------
# Fixtures
# --------------------------------------------------------------------------------------
@pytest.fixture
def mait(db):
    return MaitFactory()


@pytest.fixture
def mpp(db, mait):
    return MPPFactory(mait=mait)


@pytest.fixture
def member(db, mpp):
    return MemberFactory(mpp=mpp)


@pytest.fixture
def animal(db, member):
    return AnimalFactory(member=member)


@pytest.fixture
def stocked_mait(db, mait):
    """
    A Mait holding exactly one straw.

    One is the interesting number: it is where a race between two completions either holds
    or produces the over-issue this platform exists to prevent (ADR 0002).
    """

    def _make(count: int = 1):
        straws = []
        for _ in range(count):
            straw = SemenBatchFactory()
            MaitInventory.objects.create(
                mait=mait,
                product_type=ProductType.STRAW,
                product_ref_id=straw.id,
                qty_available=1,
            )
            straws.append(straw)
        return straws

    return _make


@pytest.fixture
def ai_event_ready_to_complete(db, mait, mpp, member, animal, stocked_mait):
    """An event sitting in `payment_pending` with a verified payment and one straw held."""

    def _make():
        straw = stocked_mait(1)[0]
        event = AIEvent.objects.create(
            client_uuid=uuid.uuid4(),
            mait=mait,
            mpp=mpp,
            owner_type=AIEvent.OwnerType.MEMBER,
            member=member,
            animal=animal,
            semen_batch=straw,
            straw_unique_no=straw.unique_straw_no,
            status=AIEvent.Status.PAYMENT_PENDING,
            performed_at=timezone.now(),
        )
        Payment.objects.create(
            ai_event=event,
            amount=Decimal("250.00"),
            mode=Payment.Mode.COD,
            member_otp_verified=True,
            member_otp_verified_at=timezone.now(),
            cod_otp_verified=True,
            cod_otp_verified_at=timezone.now(),
            status=Payment.Status.VERIFIED,
        )
        return event, straw

    return _make
