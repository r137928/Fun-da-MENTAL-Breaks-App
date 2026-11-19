import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import { ZodError } from "zod";
import { env } from "./config/env.js";
import { requireAuth } from "./middleware/auth.middleware.js";
import { userRoutes } from "./routes/user.routes.js";
import { breakRoutes } from "./routes/break.routes.js";
import { breakLogRoutes } from "./routes/break-log.routes.js";
export const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: env.CLIENT_ORIGIN }));
app.use(express.json({ limit: "32kb" }));
app.get("/health", (_req, res) => { res.json({ status: "ok" }); });
app.use("/api/users", requireAuth, userRoutes);
app.use("/api/breaks", requireAuth, breakRoutes);
app.use("/api/break-logs", requireAuth, breakLogRoutes);
app.use((_req, res) => { res.status(404).json({ message: "Route not found" }); });
const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({ message: "Invalid input", issues: error.issues }); return;
  }
  if (error?.type === "entity.parse.failed") {
    res.status(400).json({ message: "Invalid JSON" }); return;
  }
  if (error?.type === "entity.too.large") {
    res.status(413).json({ message: "Request body too large" }); return;
  }
  if (error?.code === "23505") {
    res.status(409).json({ message: "Record already exists" }); return;
  }
  if (["23514", "23502", "23503", "22P02"].includes(error?.code)) {
    res.status(400).json({ message: "Invalid record data" }); return;
  }
  if (error?.code === "42501") {
    res.status(403).json({ message: "Access denied" }); return;
  }
  console.error("Request failed", error?.code ?? error?.name ?? "unknown");
  res.status(500).json({ message: "Request could not be completed" });
};
app.use(errorHandler);
