const express = require("express");
const { query } = require("../db");

const router = express.Router();

router.get("/tasks", async (req, res) => {
  const tasks = await query("SELECT * FROM tasks ORDER BY created_at DESC");
  res.json(tasks);
});

router.get("/tasks/:id", async (req, res) => {
  const [task] = await query("SELECT * FROM tasks WHERE id = $1", [req.params.id]);
  if (!task) return res.status(404).json({ error: "not found" });
  res.json(task);
});

router.post("/tasks", async (req, res) => {
  const { title, done } = req.body;
  const [task] = await query(
    "INSERT INTO tasks (title, done) VALUES ($1, $2) RETURNING *",
    [title, done ?? false],
  );
  res.status(201).json(task);
});

router.put("/tasks/:id", async (req, res) => {
  const { title, done } = req.body;
  const [task] = await query(
    "UPDATE tasks SET title = $1, done = $2 WHERE id = $3 RETURNING *",
    [title, done, req.params.id],
  );
  res.json(task);
});

router.delete("/tasks/:id", async (req, res) => {
  await query("DELETE FROM tasks WHERE id = $1", [req.params.id]);
  res.status(204).end();
});

module.exports = router;
