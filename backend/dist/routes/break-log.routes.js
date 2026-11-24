import { Router } from "express";
import { listBreakLogs, getBreakLog, createBreakLog, updateBreakLog, deleteBreakLog, } from "../controllers/break-log.controller.js";
export const breakLogRoutes = Router();
breakLogRoutes.get("/", listBreakLogs);
breakLogRoutes.get("/:id", getBreakLog);
breakLogRoutes.post("/", createBreakLog);
breakLogRoutes.patch("/:id", updateBreakLog);
breakLogRoutes.delete("/:id", deleteBreakLog);
