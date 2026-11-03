"""Backend tests use their own SQLite database (never the developer's .data/twin.db)."""
import os
import tempfile

os.environ["TWIN_DATA_DIR"] = tempfile.mkdtemp(prefix="twin-backend-tests-")
os.environ.pop("TWIN_DB_PATH", None)
