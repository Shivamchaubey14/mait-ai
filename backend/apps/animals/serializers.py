"""Animal and breed serializers (SRS §6.3 step 3, §9.4)."""

from __future__ import annotations

from rest_framework import serializers

from apps.masterdata.models import Member, NonMember

from .models import Animal, AnimalType, BreedConfig


class BreedConfigSerializer(serializers.ModelSerializer):
    """
    One breed option for the picker.

    Carries the Hindi label alongside the English so the app never has to hold a second
    mapping of its own — the list a Mait sees comes entirely from here.
    """

    class Meta:
        model = BreedConfig
        fields = ["code", "name", "name_hi", "animal_type", "rate", "display_order"]
        read_only_fields = fields


class BreedConfigWriteSerializer(serializers.ModelSerializer):
    """
    The admin's edit shape for the semen list (SRS §6.3 step 3, §6.6.1).

    ``code`` and ``animal_type`` are set once together: they are the pair every straw, indent
    and stock row keys on, and changing either would orphan the lot. Everything a Mait reads
    — both labels, the rate, the ordering — stays editable.
    """

    class Meta:
        model = BreedConfig
        fields = [
            "id",
            "code",
            "name",
            "name_hi",
            "animal_type",
            "rate",
            "display_order",
            "is_active",
        ]

    def validate(self, attrs):
        code = (attrs.get("code") or "").strip().upper()
        animal_type = attrs.get("animal_type")
        if self.instance is None:
            if not code:
                raise serializers.ValidationError({"code": "A code is required."})
            if BreedConfig.objects.filter(code=code, animal_type=animal_type).exists():
                raise serializers.ValidationError(
                    {"code": "This breed is already listed for that animal type."}
                )
            attrs["code"] = code
        return attrs

    def update(self, instance, validated_data):
        # Ignored rather than rejected: the portal sends the whole object back, and an
        # unchanged key in the payload is not an attempt to re-key the breed.
        validated_data.pop("code", None)
        validated_data.pop("animal_type", None)
        return super().update(instance, validated_data)


class AnimalSerializer(serializers.ModelSerializer):
    """Read shape for an animal."""

    animal_type_display = serializers.CharField(source="get_animal_type_display", read_only=True)
    owner_name = serializers.SerializerMethodField()
    # Both are annotations (apps.animals.queries), not columns. The defaults cover the one
    # caller that has neither: the freshly created animal echoed back from POST /animals/,
    # which by definition has no history yet.
    ai_event_count = serializers.IntegerField(read_only=True, default=0)
    last_ai_at = serializers.DateTimeField(read_only=True, default=None)

    class Meta:
        model = Animal
        fields = [
            "id",
            "owner_type",
            "member",
            "non_member",
            "owner_name",
            "animal_type",
            "animal_type_display",
            "breed",
            "ear_tag_no",
            "ai_event_count",
            "last_ai_at",
            "created_at",
        ]
        read_only_fields = fields

    def get_owner_name(self, obj) -> str:
        owner = obj.owner
        return getattr(owner, "member_name", None) or getattr(owner, "name", "")


class AnimalCreateSerializer(serializers.Serializer):
    """
    Register an animal against a member or a non-member (SRS §6.3 step 3).

    Ownership is a nullable pair rather than a generic relation, so exactly one of the two
    must be supplied — enforced here for a readable error and again by a database constraint
    so no code path can create an orphan.
    """

    member_code = serializers.CharField(required=False, allow_blank=True)
    non_member_id = serializers.IntegerField(required=False, allow_null=True)
    animal_type = serializers.ChoiceField(choices=AnimalType.choices)
    # Optional: step 4 of the capture flow registers the animal in front of the Mait from what
    # they can see — cow or buffalo, and the tag if she carries one. Her breed is a judgement
    # they often cannot make, and asking anyway would fill the column with guesses. The breed
    # asked for later in the flow is the straw's, which is a different fact about a different
    # thing.
    breed = serializers.CharField(max_length=30, required=False, allow_blank=True)
    ear_tag_no = serializers.CharField(
        max_length=20, required=False, allow_blank=True, allow_null=True
    )

    def validate(self, attrs):
        member_code = (attrs.get("member_code") or "").strip()
        non_member_id = attrs.get("non_member_id")

        if bool(member_code) == bool(non_member_id):
            raise serializers.ValidationError("Supply exactly one of member_code or non_member_id.")

        mait = self.context["mait"]

        if member_code:
            member = Member.objects.filter(member_code=member_code).select_related("mpp").first()
            if member is None:
                raise serializers.ValidationError({"member_code": "No such member."})
            # SRS §16 — a Mait may only act at their own MPPs. Checked here as well as in
            # the queryset because this endpoint takes a code rather than filtering a list.
            if member.mpp.mait_id != mait.id:
                raise serializers.ValidationError(
                    {"member_code": "This member is not at one of your MPPs."}
                )
            attrs["owner"] = member
            attrs["owner_type"] = Animal.OwnerType.MEMBER
        else:
            non_member = NonMember.objects.filter(pk=non_member_id).select_related("mpp").first()
            if non_member is None:
                raise serializers.ValidationError({"non_member_id": "No such non-member."})
            if non_member.mpp.mait_id != mait.id:
                raise serializers.ValidationError(
                    {"non_member_id": "This non-member is not at one of your MPPs."}
                )
            attrs["owner"] = non_member
            attrs["owner_type"] = Animal.OwnerType.NON_MEMBER

        return attrs

    def validate_breed(self, value: str) -> str:
        """
        Blank, or one the admin has configured.

        Free text here would make the dashboard's breed breakdown meaningless within a
        month — "Gir", "gir" and "GIR" would all be different breeds. Blank is not free text:
        it is the honest record of a breed nobody established.
        """
        code = (value or "").strip().upper()
        if not code:
            return ""
        if not BreedConfig.objects.filter(code__iexact=code, is_active=True).exists():
            raise serializers.ValidationError("Unknown breed. Use a code from /config/breeds/.")
        return code

    def validate_ear_tag_no(self, value):
        """
        Optional, but unique across the platform when present (SRS §6.3 step 3).

        Checked here for a message that names the clash; the database constraint is what
        actually guarantees it.
        """
        tag = (value or "").strip()
        if not tag:
            return None
        clash = Animal.objects.filter(ear_tag_no=tag).first()
        if clash is not None:
            raise serializers.ValidationError(
                f"Ear tag {tag} is already registered to another animal."
            )
        return tag

    def create(self, validated_data):
        owner = validated_data["owner"]
        owner_type = validated_data["owner_type"]
        return Animal.objects.create(
            owner_type=owner_type,
            member=owner if owner_type == Animal.OwnerType.MEMBER else None,
            non_member=owner if owner_type == Animal.OwnerType.NON_MEMBER else None,
            animal_type=validated_data["animal_type"],
            breed=validated_data.get("breed", ""),
            ear_tag_no=validated_data.get("ear_tag_no"),
        )


class AnimalUpdateSerializer(serializers.Serializer):
    """Correct a breed or add an ear tag later (SRS §9.4)."""

    breed = serializers.CharField(max_length=30, required=False)
    ear_tag_no = serializers.CharField(
        max_length=20, required=False, allow_blank=True, allow_null=True
    )

    validate_breed = AnimalCreateSerializer.validate_breed

    def validate_ear_tag_no(self, value):
        tag = (value or "").strip()
        if not tag:
            return None
        clash = Animal.objects.filter(ear_tag_no=tag).exclude(pk=self.instance.pk).first()
        if clash is not None:
            raise serializers.ValidationError(
                f"Ear tag {tag} is already registered to another animal."
            )
        return tag

    def update(self, instance, validated_data):
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()
        return instance
