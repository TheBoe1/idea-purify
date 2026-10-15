CREATE TABLE IF NOT EXISTS app_user (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    username VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    nickname VARCHAR(40) NULL,
    email VARCHAR(254) CHARACTER SET ascii COLLATE ascii_bin NULL UNIQUE,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    password_hash VARCHAR(255) CHARACTER SET ascii NOT NULL,
    role ENUM('user', 'admin') NOT NULL DEFAULT 'user',
    disabled BOOLEAN NOT NULL DEFAULT FALSE,
    auth_version INT UNSIGNED NOT NULL DEFAULT 1,
    created_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS idea (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    idea_content VARCHAR(255) NOT NULL,
    create_time DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    INDEX idea_owner_time (user_id, create_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS auth_session (
    session_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    expires INT UNSIGNED NOT NULL,
    data MEDIUMTEXT NOT NULL,
    INDEX session_expiration (expires)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS auth_email_token (
    token_hash BINARY(32) PRIMARY KEY,
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    purpose ENUM('verify-email', 'reset-password') NOT NULL,
    expires_time DATETIME NOT NULL,
    used_time DATETIME NULL,
    INDEX email_token_owner (user_id, purpose)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS component_definition (
    component_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    library_key VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    library_version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
    schema_version SMALLINT UNSIGNED NOT NULL,
    metadata_json JSON NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS component_config (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    component_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    schema_version SMALLINT UNSIGNED NOT NULL,
    schema_json JSON NOT NULL,
    revision INT UNSIGNED NOT NULL DEFAULT 1,
    created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    updated_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_time DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_time DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX component_config_updated (updated_time),
    INDEX component_config_definition (component_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ui_page_config (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    name VARCHAR(64) NOT NULL,
    target_kind ENUM('dynamic', 'existing') NOT NULL,
    page_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    region_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    draft_schema JSON NOT NULL,
    draft_revision INT UNSIGNED NOT NULL DEFAULT 1,
    published_name VARCHAR(64) NULL,
    published_schema JSON NULL,
    published_revision INT UNSIGNED NULL,
    published_time DATETIME(3) NULL,
    created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    updated_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_time DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_time DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY ui_page_target (target_kind, page_key, region_key),
    INDEX ui_page_updated (updated_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
