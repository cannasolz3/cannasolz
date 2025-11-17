import cron from 'node-cron';
import { spawn } from 'child_process';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadMonitoringConfig } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '.env') });

const JOB_SCRIPTS = {
  syncCollections: 'sync-collections.js',
  syncHolders: 'sync-holders.js',
  syncCnftCollections: 'sync-cnft-collections.js',
  syncRoles: 'sync-roles.js',
  processDailyRewards: 'process-daily-rewards.js'
};

const monitoringConfig = loadMonitoringConfig();
const timezone = monitoringConfig.timezone || process.env.MONITORING_TZ || 'UTC';

function runScript(scriptName) {
  return new Promise((resolve, reject) => {
    const scriptPath = join(__dirname, scriptName);
    console.log(`[${new Date().toISOString()}] Running ${scriptPath}`);

    const child = spawn('node', [scriptPath], {
      stdio: 'inherit',
      env: process.env
    });

    child.on('error', (error) => {
      console.error(`Error running ${scriptPath}:`, error);
      reject(error);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        console.error(`${scriptPath} exited with code ${code}`);
        reject(new Error(`${scriptPath} failed`));
      } else {
        console.log(`${scriptPath} completed`);
        resolve();
      }
    });
  });
}

function scheduleJobs() {
  const jobs = monitoringConfig.jobs || {};
  Object.entries(jobs).forEach(([key, jobConfig]) => {
    if (!jobConfig || jobConfig.enabled === false) {
      console.log(`Skipping disabled job ${key}`);
      return;
    }

    const script = JOB_SCRIPTS[key];
    if (!script) {
      console.warn(`No script registered for job ${key}`);
      return;
    }

    const schedule = jobConfig.schedule || '* * * * *';
    console.log(`Scheduling ${key} (${script}) with cron ${schedule} (${timezone})`);

    cron.schedule(schedule, () => {
      runScript(script).catch((err) => {
        console.error(`Job ${key} failed:`, err);
      });
    }, { timezone });

    if (jobConfig.runOnStart !== false) {
      runScript(script).catch((err) => {
        console.error(`Initial run for ${key} failed:`, err);
      });
    }
  });
}

console.log('Starting monitoring scheduler...');
scheduleJobs();

process.on('SIGTERM', () => {
  console.log('Received SIGTERM. Exiting...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT. Exiting...');
  process.exit(0);
});
