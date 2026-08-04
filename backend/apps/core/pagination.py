"""Pagination shared by every list endpoint (SRS §9.11)."""

from rest_framework.pagination import LimitOffsetPagination


class StandardLimitOffsetPagination(LimitOffsetPagination):
    """
    Consistent ``{count, next, previous, results}`` envelope.

    ``max_limit`` is a guard, not a preference: the member table holds 105k+ rows and an
    unbounded limit would let one request try to serialise all of them.
    """

    default_limit = 50
    max_limit = 500
    limit_query_param = "limit"
    offset_query_param = "offset"
