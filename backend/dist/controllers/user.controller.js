import { User, userInput, userPatch } from "../models/User.js";
import { checkDatabase } from "../utils/database.js";
export const getProfile = async (req, res) => {
    const { data, error } = await User.findById(req.db, req.userId);
    checkDatabase(error);
    if (!data) {
        res.status(404).json({ message: "Profile not found" });
        return;
    }
    res.json({ ...data, email: req.userEmail ?? null });
};
export const createProfile = async (req, res) => {
    const { data, error } = await User.create(req.db, req.userId, userInput.parse(req.body));
    checkDatabase(error);
    res.status(201).json({ ...data, email: req.userEmail ?? null });
};
export const updateProfile = async (req, res) => {
    const input = userPatch.refine(value => Object.keys(value).length > 0).parse(req.body);
    const { data, error } = await User.update(req.db, req.userId, input);
    checkDatabase(error);
    if (!data) {
        res.status(404).json({ message: "Profile not found" });
        return;
    }
    res.json({ ...data, email: req.userEmail ?? null });
};
