import type { RequestHandler } from "express";
import { z } from "zod";
import { BreakLog, breakLogInput, breakLogPatch, logStatus } from "../models/BreakLog.js";
import { checkDatabase } from "../utils/database.js";
import { pagination } from "../utils/validation.js";

export const listBreakLogs: RequestHandler = async (req, res) => {
  const { offset, limit, status } = pagination.extend({ status: logStatus.optional() }).parse(req.query);
  const { data, error } = await BreakLog.list(req.db, req.userId, offset, limit, status);
  checkDatabase(error);
  res.json({ data, offset, limit });
};
export const getBreakLog: RequestHandler = async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const { data, error } = await BreakLog.findById(req.db, req.userId, id);
  checkDatabase(error);
  if (!data) { res.status(404).json({ message: "Break log not found" }); return; }
  res.json(data);
};
export const createBreakLog: RequestHandler = async (req, res) => {
  const { data, error } = await BreakLog.create(req.db, req.userId, breakLogInput.parse(req.body));
  checkDatabase(error);
  res.status(201).json(data);
};
export const updateBreakLog: RequestHandler = async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const { data, error } = await BreakLog.update(req.db, req.userId, id, breakLogPatch.parse(req.body));
  checkDatabase(error);
  if (!data) { res.status(404).json({ message: "Break log not found" }); return; }
  res.json(data);
};
export const deleteBreakLog: RequestHandler = async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const { data, error } = await BreakLog.remove(req.db, req.userId, id);
  checkDatabase(error);
  if (!data) { res.status(404).json({ message: "Break log not found" }); return; }
  res.sendStatus(204);
};
