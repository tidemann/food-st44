from django.conf import settings
from django.http import FileResponse, Http404, HttpRequest


def spa(request: HttpRequest) -> FileResponse:
    """Serve the Angular index.html; the client-side router takes it from there."""
    index = settings.SPA_DIR / "index.html"
    if not index.is_file():
        raise Http404("frontend not built")
    return FileResponse(index.open("rb"), content_type="text/html; charset=utf-8")
