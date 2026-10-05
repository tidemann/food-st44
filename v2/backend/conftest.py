from django.conf import settings

# Settings refuse to start without a key outside DEBUG; tests run with a throwaway one. Set on
# the settings object, not os.environ: pytest-django has imported the settings before this file
# is loaded, so an environment variable set here comes too late.
settings.SECRET_KEY = "test-only"  # noqa: S105
