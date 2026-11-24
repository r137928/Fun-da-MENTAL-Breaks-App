import { z } from "zod";
import { Break, breakInput, breakPatch } from "../models/Break.js";
import { checkDatabase } from "../utils/database.js";
import { pagination } from "../utils/validation.js";
export const listBreaks = async (req, res) => {
    const { offset, limit } = pagination.parse(req.query);
    const { data, error } = await Break.list(req.db, req.userId, offset, limit);
    checkDatabase(error);
    res.json({ data, offset, limit });
};
export const createBreak = async (req, res) => {
    const { data, error } = await Break.create(req.db, req.userId, breakInput.parse(req.body));
    checkDatabase(error);
    res.status(201).json(data);
};
export const updateBreak = async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const input = breakPatch.parse(req.body);
    const { data, error } = await Break.update(req.db, req.userId, id, input);
    checkDatabase(error);
    if (!data) {
        res.status(404).json({ message: "Break not found" });
        return;
    }
    res.json(data);
};
export const deleteBreak = async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const { data, error } = await Break.remove(req.db, req.userId, id);
    checkDatabase(error);
    if (!data) {
        res.status(404).json({ message: "Break not found" });
        return;
    }
    res.sendStatus(204);
};
