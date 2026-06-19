import logging
from logging.handlers import RotatingFileHandler
import os
import config
LOG_FILE = config.LOG_FILE

def setup_logging(level=logging.INFO):
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    logger = logging.getLogger()
    logger.setLevel(level)

    if not logger.handlers:
        fh = RotatingFileHandler(LOG_FILE, maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8")
        fmt = logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s")
        fh.setFormatter(fmt)
        logger.addHandler(fh)

    return logger
