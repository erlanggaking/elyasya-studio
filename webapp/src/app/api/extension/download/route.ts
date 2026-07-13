import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import os from "os";

const execFileAsync = promisify(execFile);

// Zip folder extension (sibling repo: ../extension) dan kirim sebagai download.
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const extDir = path.resolve(process.cwd(), "..", "extension");
  if (!fs.existsSync(path.join(extDir, "manifest.json"))) {
    return NextResponse.json(
      { ok: false, error: "Folder extension tidak ditemukan di server" },
      { status: 404 }
    );
  }

  const tmpZip = path.join(os.tmpdir(), `elyasya-extension-${Date.now()}.zip`);
  try {
    await execFileAsync("zip", ["-r", "-q", tmpZip, ".", "-x", "_metadata/*"], {
      cwd: extDir,
    });
    const buf = fs.readFileSync(tmpZip);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="elyasya-studio-extension.zip"',
      },
    });
  } catch (err) {
    console.error("[extension/download]", err);
    return NextResponse.json({ ok: false, error: "Gagal membuat ZIP" }, { status: 500 });
  } finally {
    fs.rmSync(tmpZip, { force: true });
  }
}
