CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Utilisateur par défaut
INSERT INTO users (username, password, role)
VALUES ('Administrateur', 'Admin123', 'admin')
ON CONFLICT (username) DO NOTHING;
