"""Report response shapes, declared so the OpenAPI schema is complete."""

from rest_framework import serializers


class ReportRowSerializer(serializers.Serializer):
    """A report row. Columns vary per report; see each view's docstring."""

    def to_representation(self, instance):
        return instance


class ReportResponseSerializer(serializers.Serializer):
    results = ReportRowSerializer(many=True)


class UpcomingBirthdaySerializer(serializers.Serializer):
    """Day and month only - the birth year is deliberately not exposed."""

    id = serializers.IntegerField()
    employee_code = serializers.CharField()
    full_name = serializers.CharField()
    department_name = serializers.CharField(allow_null=True)
    designation_name = serializers.CharField(allow_null=True)
    photo_url = serializers.CharField(allow_null=True)
    day = serializers.IntegerField()
    month = serializers.IntegerField()
    celebrated_on = serializers.DateField()
    days_until = serializers.IntegerField()
    is_today = serializers.BooleanField()


class BirthdayCalendarSerializer(serializers.Serializer):
    """The year of birthdays behind the dashboard card, shaped like a list page."""

    count = serializers.IntegerField()
    results = UpcomingBirthdaySerializer(many=True)


class UpcomingHolidaySerializer(serializers.Serializer):
    id = serializers.IntegerField()
    date = serializers.DateField()
    name = serializers.CharField()
    description = serializers.CharField(allow_blank=True)
    is_optional = serializers.BooleanField()
    day_of_week = serializers.CharField()
    days_until = serializers.IntegerField()
    is_today = serializers.BooleanField()


class DashboardSummarySerializer(serializers.Serializer):
    """Role-aware dashboard payload; sections appear only when applicable."""

    as_of = serializers.DateField()
    horizon_days = serializers.IntegerField()
    upcoming_birthdays = UpcomingBirthdaySerializer(many=True)
    upcoming_holidays = UpcomingHolidaySerializer(many=True)
    me = serializers.DictField(required=False)
    approvals = serializers.DictField(required=False)
    organization = serializers.DictField(required=False)
