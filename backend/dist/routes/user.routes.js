import { Router } from "express";
import { createProfile, getProfile, updateProfile } from "../controllers/user.controller.js";
export const userRoutes = Router();
userRoutes.get("/me", getProfile);
userRoutes.post("/me", createProfile);
userRoutes.patch("/me", updateProfile);
