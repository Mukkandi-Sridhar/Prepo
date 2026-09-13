CREATE TABLE tasks (
  id          serial PRIMARY KEY,
  title       text NOT NULL,
  done        boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
