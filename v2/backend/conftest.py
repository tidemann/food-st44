import os

# Settings refuse to start without a key outside DEBUG; tests run with a throwaway one.
os.environ.setdefault("DJANGO_SECRET_KEY", "test-only")
