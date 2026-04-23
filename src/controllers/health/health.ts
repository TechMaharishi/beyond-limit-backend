import { Request, Response } from "express";
import os from "os";
import mongoose from "mongoose";
import { monitorEventLoopDelay } from "perf_hooks";
import * as PerfHooks from "perf_hooks";
import dns from "dns";
import cloudinary from "@/config/cloudinary";
import admin from "@/config/firebase";

const startedAt = new Date();
const loopMonitor = monitorEventLoopDelay();
loopMonitor.enable();
const serviceName = "server";
const serviceVersion = process.env.APP_VERSION || "dev";

function getProcessMetrics() {
  const mem = process.memoryUsage();
  const ru = (process as any).resourceUsage ? (process as any).resourceUsage() : undefined;
  const elufn = (PerfHooks as any).eventLoopUtilization;
  const elu = elufn ? elufn() : { idle: 0, active: 0, utilization: 0 };
  const loop = {
    avg: Number((loopMonitor.mean / 1e6).toFixed(2)),
    max: Number((loopMonitor.max / 1e6).toFixed(2)),
  };
  const rssMB = Math.round(mem.rss / (1024 * 1024));
  const heapUsedMB = Math.round(mem.heapUsed / (1024 * 1024));
  const heapTotalMB = Math.round(mem.heapTotal / (1024 * 1024));
  const handles = (process as any)._getActiveHandles ? (process as any)._getActiveHandles().length : undefined;
  const requests = (process as any)._getActiveRequests ? (process as any)._getActiveRequests().length : undefined;
  const loopStatus = loop.max > 200 || loop.avg > 50 ? "degraded" : "healthy";
  return {
    pid: process.pid,
    memoryMB: { rss: rssMB, heapUsed: heapUsedMB, heapTotal: heapTotalMB },
    cpuMicros: ru ? { user: ru.userCPUTime, system: ru.systemCPUTime } : undefined,
    eventLoopDelayMs: loop,
    eventLoopStatus: loopStatus,
    eventLoopUtilization: { idle: Number(elu.idle.toFixed(4)), active: Number(elu.active.toFixed(4)), utilization: Number(elu.utilization.toFixed(4)) },
    handles,
    requests,
    threadpoolSize: process.env.UV_THREADPOOL_SIZE ? Number(process.env.UV_THREADPOOL_SIZE) : undefined,
  };
}

function getSystemMetrics() {
  const totalMemMB = Math.round(os.totalmem() / (1024 * 1024));
  const freeMemMB = Math.round(os.freemem() / (1024 * 1024));
  return { loadAvg: os.loadavg(), totalMemMB, freeMemMB };
}

function getDepsStatus() {
  const mongoReady = mongoose.connection.readyState;
  const fcmReady = Array.isArray((admin as any).apps) && (admin as any).apps.length > 0;
  const cloudReady = !!cloudinary.config().cloud_name;
  return {
    mongodb: { status: mongoReady === 1 ? "up" : "down", readyState: mongoReady },
    fcm: { status: fcmReady ? "up" : "down" },
    cloudinary: { status: cloudReady ? "up" : "down" },
  };
}

async function probeMongoLatency() {
  try {
    if (mongoose.connection.readyState !== 1) return undefined;
    const t0 = Date.now();
    const adminDb = (mongoose.connection as any).db.admin();
    await adminDb.ping();
    return Date.now() - t0;
  } catch {
    return undefined;
  }
}

async function probeUrlLatency(url: string) {
  try {
    const t0 = Date.now();
    const res = await fetch(url, { method: "GET" });
    const ok = res.ok;
    const ms = Date.now() - t0;
    return { ok, latencyMs: ms };
  } catch {
    return { ok: false, latencyMs: undefined };
  }
}

async function probeUrlStatus(url: string) {
  try {
    const t0 = Date.now();
    const res = await fetch(url, { method: "HEAD" });
    const ms = Date.now() - t0;
    return { status: res.status, latencyMs: ms };
  } catch {
    return { status: undefined, latencyMs: undefined };
  }
}

async function probeDns(host: string) {
  const t0 = Date.now();
  try {
    const res = await dns.promises.lookup(host);
    const ms = Date.now() - t0;
    return { ok: true, latencyMs: ms, address: res.address, family: res.family };
  } catch {
    return { ok: false, latencyMs: undefined };
  }
}

function summarizeStatus(deps: any, proc: any) {
  const issues: string[] = [];
  let status = "healthy";
  if (deps.mongodb.status !== "up") issues.push("mongo_down");
  if (deps.fcm.status !== "up") issues.push("fcm_down");
  if (deps.cloudinary.status !== "up") issues.push("cloudinary_down");
  if (proc.eventLoopStatus === "degraded") issues.push("loop_delay_high");
  if (issues.length > 0) status = "degraded";
  return { status, issues };
}

export const getHealth = async (req: Request, res: Response) => {
  const deep = String((req.query as any).deep || "").toLowerCase() === "true" || String((req.query as any).deep || "") === "1";
  const proc = getProcessMetrics();
  const sys = getSystemMetrics();
  const deps = getDepsStatus();
  const summary = summarizeStatus(deps, proc);
  const payload: any = {
    ok: mongoose.connection.readyState === 1,
    service: serviceName,
    version: serviceVersion,
    startedAt: startedAt.toISOString(),
    uptimeSec: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    status: summary.status,
    issues: summary.issues,
    process: proc,
    node: { nodeVersion: process.version, v8Version: (process as any).versions.v8 },
    system: sys,
    deps,
    build: { commitSha: process.env.COMMIT_SHA || undefined, buildTimestamp: process.env.BUILD_TIMESTAMP || undefined },
  };
  if (deep) {
    const mongoLatency = await probeMongoLatency();
    const cloudProbe = await probeUrlLatency("https://api.cloudinary.com/");
    const expoProbe = await probeUrlStatus("https://exp.host");
    const fcmProbe = await probeUrlLatency("https://fcm.googleapis.com");
    const slackProbe = await probeUrlStatus("https://slack.com");
    const sendgridProbe = await probeUrlStatus("https://api.sendgrid.com");
    const netProbe = await probeUrlLatency("https://www.google.com/generate_204");
    const dnsCloud = await probeDns("api.cloudinary.com");
    const dnsExpo = await probeDns("exp.host");
    const dnsFcm = await probeDns("fcm.googleapis.com");
    const dnsSlack = await probeDns("slack.com");
    const dnsSendgrid = await probeDns("api.sendgrid.com");
    payload.deps.mongodb.latencyMs = mongoLatency;
    payload.deps.cloudinary.latencyMs = cloudProbe.latencyMs;
    payload.deps.expo = { status: expoProbe.status && expoProbe.status < 500 ? "up" : "down", latencyMs: expoProbe.latencyMs };
    payload.deps.fcm.latencyMs = fcmProbe.latencyMs;
    payload.deps.slack = { status: slackProbe.status && slackProbe.status < 500 ? "up" : "down", latencyMs: slackProbe.latencyMs };
    payload.deps.sendgrid = { status: sendgridProbe.status && sendgridProbe.status < 500 ? "up" : "down", latencyMs: sendgridProbe.latencyMs };
    payload.network = { internet: { status: netProbe.ok ? "up" : "down", latencyMs: netProbe.latencyMs }, dns: { cloudinary: dnsCloud, expo: dnsExpo, fcm: dnsFcm, slack: dnsSlack, sendgrid: dnsSendgrid } };
    if (mongoose.connection.readyState === 1) {
      try {
        const stats = await (mongoose.connection as any).db.stats();
        payload.mongoStats = { collections: stats.collections, objects: stats.objects, dataSize: stats.dataSize, storageSize: stats.storageSize, indexes: stats.indexes };
      } catch {}
    }
  }
  return res.status(200).json(payload);
};

