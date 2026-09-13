require("dotenv").config();
const express = require("express");
const tasksRouter = require("./routes/tasks");

const app = express();
app.use(express.json());
app.use("/api", tasksRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`listening on ${PORT}`));

module.exports = app;
