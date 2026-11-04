"""Backend tests use their own SQLite database (never the developer's .data/twin.db)."""
import os
import tempfile

os.environ["TWIN_DATA_DIR"] = tempfile.mkdtemp(prefix="twin-backend-tests-")
os.environ.pop("TWIN_DB_PATH", None)
os.environ["TWIN_SKIP_ENV_FILES"] = "1"  # never pick up the developer's keys from the repo-root .env
