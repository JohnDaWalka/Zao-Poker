import fs from 'fs';
import path from 'path';
import { app } from 'electron';

export function getSummaryFilePath(): string {
  // Save to Documents/PokerTherapist/session_summary.txt
  const docPath = app.getPath('documents');
  const folder = path.join(docPath, 'PokerTherapist');
  if (!fs.existsSync(folder)) {
    try {
      fs.mkdirSync(folder, { recursive: true });
    } catch (e) {
      console.error('Could not create summary folder', e);
      return path.join(app.getPath('userData'), 'session_summary.txt');
    }
  }
  return path.join(folder, 'session_summary.txt');
}

export function writeHandSummary(site: string, rawHand: string) {
  const filePath = getSummaryFilePath();
  const timestamp = new Date().toISOString();
  const divider = '\n' + '='.repeat(50) + '\n';
  
  const entry = `${divider}TIME: ${timestamp}\nSITE: ${site}\n${divider}${rawHand}\n`;
  
  try {
    fs.appendFileSync(filePath, entry, 'utf8');
    console.log(`[HandWriter] Wrote hand to ${filePath}`);
  } catch (err) {
    console.error(`[HandWriter] Failed to write hand summary: ${err}`);
  }
}
