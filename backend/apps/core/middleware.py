"""Request-scoped middleware."""

import uuid

REQUEST_ID_HEADER = "HTTP_X_REQUEST_ID"


class RequestIDMiddleware:
    """
    Attach a request ID to every request and echo it back on the response.

    Mobile clients log the ID alongside their own errors, which is what makes a field
    report ("payment failed around 3pm") traceable to a specific server-side request.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.request_id = request.META.get(REQUEST_ID_HEADER) or str(uuid.uuid4())
        response = self.get_response(request)
        response["X-Request-ID"] = request.request_id
        return response
