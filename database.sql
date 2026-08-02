-- =====================================================
--  Relay Music Player — MySQL database schema
--  Import with:  mysql -u root -p < database.sql
-- =====================================================

CREATE DATABASE IF NOT EXISTS relay_music
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE relay_music;

-- Users table used by the login / signup pages
CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100)  NOT NULL,
  email         VARCHAR(190)  NOT NULL UNIQUE,
  password_hash VARCHAR(255)  NOT NULL,
  is_admin      TINYINT(1)    NOT NULL DEFAULT 0,  -- 1 = can manage the songs library
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The first account created becomes the admin (see php/setup.php).

-- Playlists owned by users
CREATE TABLE IF NOT EXISTS playlists (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  name       VARCHAR(120) NOT NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_playlists_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tracks inside a playlist (full snapshot of the track metadata)
CREATE TABLE IF NOT EXISTS playlist_tracks (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  playlist_id INT UNSIGNED NOT NULL,
  deezer_id   BIGINT       NOT NULL,
  title       VARCHAR(255) NOT NULL,
  artist      VARCHAR(255) NOT NULL,
  album       VARCHAR(255) NOT NULL DEFAULT '',
  cover       VARCHAR(500) NOT NULL DEFAULT '',
  cover_big   VARCHAR(500) NOT NULL DEFAULT '',
  preview     VARCHAR(500) NOT NULL DEFAULT '',
  duration    INT          NOT NULL DEFAULT 0,
  source      VARCHAR(20)  NOT NULL DEFAULT '',  -- 'database' or 'jamendo'
  added_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_playlist_track (playlist_id, deezer_id),
  CONSTRAINT fk_playlist_tracks_playlist
    FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Your own music catalog (hybrid: used first, Jamendo is the fallback)
CREATE TABLE IF NOT EXISTS songs (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  jamendo_id BIGINT       NULL UNIQUE,      -- source id (NULL for manual rows)
  title      VARCHAR(255) NOT NULL,
  artist     VARCHAR(255) NOT NULL,
  album      VARCHAR(255) NOT NULL DEFAULT '',
  cover      VARCHAR(500) NOT NULL DEFAULT '',
  duration   INT          NOT NULL DEFAULT 0,
  audio_url  VARCHAR(500) NOT NULL DEFAULT '',
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_songs_search ON songs (title, artist);
