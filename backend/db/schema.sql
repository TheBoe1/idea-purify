CREATE TABLE IF NOT EXISTS app_user (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    username VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
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
