"""
Pre-aggregated reporting tables (SRS §6.7, §7 Performance).

Dashboards read these, never the raw ``ai_event`` table. With 105k+ members and a growing
event volume, computing "AI events this month grouped by district" live would scan the whole
table on every page load; the requirement is a P95 under 400 ms.

Rows are written by ``apps.dashboard.tasks.aggregate_daily_ai_counts`` on an hourly schedule
and are always rebuildable from the raw events, so a bad aggregation is recoverable by
re-running the job rather than by restoring a backup.
"""

from __future__ import annotations

from django.db import models

from apps.core.models import TimeStampedModel


class DailyAIAggregate(TimeStampedModel):
    """
    One row per (date, MPP, Mait) with that day's totals.

    Granular enough to serve every §6.7 view — trends filter by district via the MPP join,
    the leaderboard groups by Mait, coverage counts distinct members — without keeping a
    separate table per report.
    """

    date = models.DateField(db_index=True)
    mpp = models.ForeignKey(
        "masterdata.MPP", on_delete=models.CASCADE, related_name="daily_aggregates"
    )
    mait = models.ForeignKey(
        "masterdata.Mait", on_delete=models.CASCADE, related_name="daily_aggregates"
    )
    district_code = models.CharField(
        max_length=10, blank=True, db_index=True,
        help_text="Denormalised from the MPP so district filters avoid a join.",
    )

    ai_count = models.PositiveIntegerField(default=0)
    member_ai_count = models.PositiveIntegerField(default=0)
    non_member_ai_count = models.PositiveIntegerField(default=0)
    distinct_members_served = models.PositiveIntegerField(default=0)
    amount_collected = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    cod_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    online_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    class Meta:
        db_table = "daily_ai_aggregate"
        ordering = ["-date"]
        constraints = [
            models.UniqueConstraint(
                fields=["date", "mpp", "mait"], name="uniq_daily_aggregate_slice"
            ),
        ]
        indexes = [
            models.Index(fields=["date", "district_code"], name="agg_date_district_idx"),
            models.Index(fields=["mait", "date"], name="agg_mait_date_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.date} {self.mpp.mpp_code}/{self.mait.name}: {self.ai_count}"


class PlatformMilestone(TimeStampedModel):
    """
    All-time highs called out on the home dashboard (SRS §6.7.2).

    Stored rather than derived because "highest single day ever" is a max over the entire
    history, and recomputing it on every dashboard load defeats the pre-aggregation.
    """

    class Kind(models.TextChoices):
        HIGHEST_DAY = "highest_day", "Highest single day"
        HIGHEST_MONTH = "highest_month", "Highest single month"

    kind = models.CharField(max_length=20, choices=Kind.choices, unique=True)
    value = models.PositiveIntegerField(default=0)
    occurred_on = models.DateField(null=True, blank=True)
    label = models.CharField(
        max_length=30, blank=True, help_text="Display label, e.g. 'March 2026'."
    )

    class Meta:
        db_table = "platform_milestone"

    def __str__(self) -> str:
        return f"{self.get_kind_display()}: {self.value} ({self.label or self.occurred_on})"
