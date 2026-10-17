const express = require('express');
const app = express();
const path = require('path');
const session = require("express-session");
const { v4: uuidv4 } = require("uuid");
const methodOverride = require("method-override");

// server start
app.listen(8080,()=>{
    console.log('Server listening at port 8080');
})
// To serve the static html,css and js files
app.use(express.static(path.join(__dirname,'public')));

// to parse the upcoming data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// setting default view engine 
app.set('view engine','ejs');

// To override the upcoming request
app.use(methodOverride("_method"));


// js object acting as a temporary database
let users = {};
let tasks = {}
// Middleware
app.use(
  session({
    secret: "task-manager-secret",
    resave: false,
    saveUninitialized: false
  })
);

//  logged-in user page (middleware function)
function requireLogin(req, res, next) {
  if (!req.session.userId || !users[req.session.userId]) {
    return res.redirect("/login");
  }
  next();
}

// task dependency
function getTaskInfo(task) {
  const dependencies = task.dependencies.map( id => tasks[id] ).filter(Boolean);
  const blocked = dependencies.some( dependency => dependency.status !== "Done" );
  return { ...task, dependencies, blocked };
}

// Home page
app.get("/", (req, res) => {
  res.redirect("/tasks");
});

// view all users
app.get("/users", (req, res) => {
  res.render("users.ejs", {
    users: Object.values(users)
  });
});

// Create user
app.post("/users", (req, res) => {
  const { username, password } = req.body;
  if (!username?.trim() || !password) {
    return res.status(400).send("Username and password are required.");
  }
  const exists = Object.values(users).some(
    user => user.username.toLowerCase() === username.trim().toLowerCase()
  );

  if (exists) {
    return res.status(400).send("Username already exists.");
  }

  const id = uuidv4();
  users[id] = { id, username: username.trim(), password };
  res.redirect("/users");
});

// Login page
app.get("/login", (req, res) => {
  res.render("login.ejs", { error: null });
});

// Login
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  const user = Object.values(users).find(
    user =>
      user.username.toLowerCase() === (username || "").trim().toLowerCase() &&
      user.password === password
  );

  if (!user) {
    return res.status(401).render("login", { error: "Invalid username or password." });
  }

  req.session.userId = user.id;
  res.redirect("/tasks");
});

// Logout
app.post("/logout", requireLogin, (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});


// View tasks assigned to the logged-in user
app.get("/tasks", requireLogin, (req, res) => {
  const currentUser = users[req.session.userId];

  const myTasks = Object.values(tasks)
    .filter(task => task.assignedTo === currentUser.id)
    .map(getTaskInfo);

  const blockedTasks = Object.values(tasks)
    .map(getTaskInfo)
    .filter(task => task.blocked && task.status !== "Done");

  res.render("tasks.ejs", { currentUser, myTasks, blockedTasks });

});

// Show create task form
app.get("/tasks/create-task", requireLogin, (req, res) => {
  res.render("create-task.ejs", { users: Object.values(users), tasks: Object.values(tasks) });
});

// Create task data
app.post("/tasks", requireLogin, (req, res) => {
  const { title, description, priority, status, assignedTo } = req.body;

  if (!title?.trim()) {
    return res.status(400).send("Task title is required.");
  }

  if (!["Low", "Medium", "High"].includes(priority)) {
    return res.status(400).send("Invalid priority.");
  }

  if (!["To Do", "In Progress", "Done"].includes(status)) {
    return res.status(400).send("Invalid status.");
  }

  if (!users[assignedTo]) {
    return res.status(400).send("Select a valid user.");
  }

  const id = uuidv4();

  tasks[id] = {
    id,
    title: title.trim(),
    description: description || "",
    priority,
    status,
    assignedTo,
    dependencies: []
  };

  res.redirect("/tasks");
});

// Show edit task form
app.get("/tasks/:id/edit", requireLogin, (req, res) => {
  const task = tasks[req.params.id];

  if (!task) {
    return res.status(404).send("Task not found.");
  }

  res.render("edit-task.ejs", {
    task,
    users: Object.values(users),
    tasks: Object.values(tasks).filter(
      otherTask => otherTask.id !== task.id
    )
  });
});

// Update task
app.put("/tasks/:id", requireLogin, (req, res) => {
  const task = tasks[req.params.id];

  if (!task) {
    return res.status(404).send("Task not found.");
  }

  const { title, description, priority, status, assignedTo, dependencies = [] } = req.body;

  const dependencyIds = Array.isArray(dependencies) ? dependencies : [dependencies];

  if (!title?.trim()) {
    return res.status(400).send("Task title is required.");
  }

  if (!["Low", "Medium", "High"].includes(priority)) {
    return res.status(400).send("Invalid priority.");
  }

  if (!["To Do", "In Progress", "Done"].includes(status)) {
    return res.status(400).send("Invalid status.");
  }

  if (!users[assignedTo]) {
    return res.status(400).send("Select a valid user.");
  }

  // Prevent self-dependency and invalid dependency IDs
  if (
    dependencyIds.some(
      id => id === task.id || !tasks[id]
    )
  ) {
    return res.status(400).send("Invalid task dependency.");
  }

  // Prevent circular dependencies
  function createsCycle(startId, targetId, visited = new Set()) {
    if (startId === targetId) return true;
    if (visited.has(startId)) return false;

    visited.add(startId);

    return tasks[startId].dependencies.some(
      dependencyId =>
        tasks[dependencyId] &&
        createsCycle(dependencyId, targetId, visited)
    );
  }

  if (dependencyIds.some(id => createsCycle(id, task.id))) {
    return res.status(400).send("Circular dependency is not allowed.");
  }

  const dependenciesAreDone = dependencyIds.every( id => tasks[id].status === "Done" );

  if (status === "Done" && !dependenciesAreDone) {
    return res.status(400).send("Complete all dependencies before marking this task Done.");
  }

  task.title = title.trim();
  task.description = description || "";
  task.priority = priority;
  task.status = status;
  task.assignedTo = assignedTo;
  task.dependencies = [...new Set(dependencyIds)];

  res.redirect("/tasks");
});

// Mark as Done
app.patch("/tasks/:id/complete", requireLogin, (req, res) => {
  const task = tasks[req.params.id];

  if (!task) {
    return res.status(404).send("Task not found.");
  }

  const dependenciesAreDone = task.dependencies.every(
    id => tasks[id] && tasks[id].status === "Done"
  );

  if (!dependenciesAreDone) {
    return res.status(400).send(
      "This task is blocked. Complete its dependencies first."
    );
  }

  task.status = "Done";
  res.redirect("/tasks");
});

// Delete task
app.delete("/tasks/:id", requireLogin, (req, res) => {
  const task = tasks[req.params.id];

  if (!task) {
    return res.status(404).send("Task not found.");
  }

  // Remove references to this task from other tasks
  Object.values(tasks).forEach(otherTask => {
    otherTask.dependencies = otherTask.dependencies.filter(
      id => id !== task.id
    );
  });

  delete tasks[task.id];

  res.redirect("/tasks");
});