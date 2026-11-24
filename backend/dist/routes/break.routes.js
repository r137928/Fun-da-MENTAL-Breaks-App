import { Router } from "express";
import { createBreak, listBreaks, updateBreak, deleteBreak } from "../controllers/break.controller.js";
export const breakRoutes = Router();
breakRoutes.get("/", listBreaks);
breakRoutes.post("/", createBreak);
breakRoutes.patch("/:id", updateBreak);
breakRoutes.delete("/:id", deleteBreak);
