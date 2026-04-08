#!/usr/bin/env node

const { execSync, spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const readline = require('readline');

// ─── Constants ───────────────────────────────────────────────────────────────

const CONFIG_DIR = path.join(os.homedir(), '.deepmine');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const CONTAINER_NAME = 'deepmine-miner';
const WATCHTOWER_NAME = 'deepmine-watchtower';
const IMAGE_BASE = 'skibidiskib/deepmine-miner';
const VOLUME_NAME = 'deepmine-data';
const DEFAULT_DASHBOARD_URL = 'https://deepmine.computers.ch';

// ─── Username Generator ─────────────────────────────────────────────────────

const ADJECTIVES = [
  'bright', 'silent', 'deep', 'swift', 'bold', 'calm', 'vast', 'keen',
  'warm', 'cool', 'wild', 'pure', 'rare', 'dark', 'soft', 'pale',
  'lunar', 'solar', 'iron', 'coral', 'amber', 'azure', 'misty', 'dusty',
  'polar', 'rapid', 'noble', 'vivid', 'dense', 'lucid', 'stark', 'brisk',
  'golden', 'frozen', 'molten', 'hidden', 'ancient', 'silent', 'steady',
  'gentle', 'fierce', 'crystal', 'mossy', 'rocky', 'sandy', 'salty',
];

const NOUNS = [
  'cave', 'reef', 'spore', 'ridge', 'delta', 'grove', 'field', 'shore',
  'frost', 'bloom', 'drift', 'stone', 'creek', 'marsh', 'cliff', 'dune',
  'peak', 'vale', 'moss', 'fern', 'vent', 'plume', 'basin', 'crest',
  'geyser', 'glacier', 'lagoon', 'canyon', 'tundra', 'steppe', 'island',
  'crater', 'cavern', 'spring', 'summit', 'ravine', 'meadow', 'quarry',
  'fossil', 'lichen', 'coral', 'kelp', 'pebble', 'ember', 'flint',
];

// Reserved usernames (seed data) that cannot be assigned
const RESERVED_USERNAMES = new Set([
  'bright.cave', 'silent.reef', 'deep.spore', 'swift.ridge',
  'bold.delta', 'calm.grove', 'vast.field', 'keen.shore',
  'polar.fern', 'amber.creek',
]);

function generateUsername() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj}.${noun}`;
}

const TIERS = {
  lite: {
    tag: 'lite',
    image: `${IMAGE_BASE}:lite`,
    size: '~2-3 GB',
    desc: 'Fast, lightweight BGC detection (GECCO only)',
  },
  standard: {
    tag: 'standard',
    image: `${IMAGE_BASE}:standard`,
    size: '~5-6 GB',
    desc: 'Better accuracy with 3 detection tools (antiSMASH + GECCO + DeepBGC)',
  },
  full: {
    tag: 'full',
    image: `${IMAGE_BASE}:full`,
    size: '~12 GB',
    desc: 'Best accuracy with ML scoring (GPU recommended)',
  },
};

const args = process.argv.slice(2);
const command = args[0] || 'start';

// ─── Banner ──────────────────────────────────────────────────────────────────

const BANNER = `
  ____  _____ _____ ____  __  __ ___ _   _ _____
 |  _ \\| ____| ____|  _ \\|  \\/  |_ _| \\ | | ____|
 | | | |  _| |  _| | |_) | |\\/| || ||  \\| |  _|
 | |_| | |___| |___|  __/| |  | || || |\\  | |___
 |____/|_____|_____|_|   |_|  |_|___|_| \\_|_____|

  Mining Earth's microbiome for new antibiotics
  Distributed computing for antibiotic discovery
`;

const HELP = `
  deepmine - Distributed computing for antibiotic discovery

  Usage:
    npx deepmine                  Setup wizard + start mining
    npx deepmine start            Same as above
    npx deepmine status           Show mining stats and container status
    npx deepmine stop             Stop mining (contributions are saved)
    npx deepmine logs             Stream pipeline output from the container
    npx deepmine dashboard        Open the web dashboard in your browser
    npx deepmine update           Pull latest image and restart container
    npx deepmine pin              Show your 6-digit login PIN
    npx deepmine reset            Remove container and config (with confirmation)
    npx deepmine help             Show this help message

  Config: ~/.deepmine/config.json
  GitHub: https://github.com/skibidiskib/deepmine
`;

// ─── Show PIN ───────────────────────────────────────────────────────────────

function commandShowPin() {
  const config = loadConfig();
  if (!config) {
    console.log('\n  No config found. Run "npx deepmine" first to set up.\n');
    process.exit(1);
  }
  if (!config.pin) {
    console.log('\n  No PIN set for this account.');
    console.log(`  Username: ${config.username || 'unknown'}`);
    console.log('  Your PIN was not saved during setup. Contact support or reset.\n');
    process.exit(1);
  }
  console.log(`\n  Username: ${config.username}`);
  console.log(`  PIN:      ${config.pin}`);
  console.log(`\n  Use this to log in at ${config.dashboard_url || DEFAULT_DASHBOARD_URL}\n`);
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function saveConfig(config) {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function checkDocker() {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function printDockerInstallInstructions() {
  const platform = process.platform;
  console.log('\n  Docker is not installed or not running.\n');
  if (platform === 'darwin') {
    console.log('  macOS: Install Docker Desktop from https://www.docker.com/products/docker-desktop/');
    console.log('         Or via Homebrew: brew install --cask docker\n');
  } else if (platform === 'linux') {
    console.log('  Linux: Install Docker Engine:');
    console.log('         sudo apt-get update && sudo apt-get install docker.io');
    console.log('         sudo systemctl start docker');
    console.log('         sudo usermod -aG docker $USER\n');
  } else if (platform === 'win32') {
    console.log('  Windows: Install Docker Desktop from https://www.docker.com/products/docker-desktop/');
    console.log('           Requires WSL 2 backend enabled.\n');
  } else {
    console.log('  Install Docker from https://docs.docker.com/get-docker/\n');
  }
}

function isContainerRunning() {
  try {
    const result = execSync(`docker ps -q -f name=${CONTAINER_NAME}`, { encoding: 'utf-8' }).trim();
    return result.length > 0;
  } catch {
    return false;
  }
}

function containerExists() {
  try {
    const result = execSync(`docker ps -aq -f name=${CONTAINER_NAME}`, { encoding: 'utf-8' }).trim();
    return result.length > 0;
  } catch {
    return false;
  }
}

function getContainerStatus() {
  try {
    return execSync(
      `docker inspect --format '{{.State.Status}}' ${CONTAINER_NAME}`,
      { encoding: 'utf-8' }
    ).trim();
  } catch {
    return null;
  }
}

function getContainerStartedAt() {
  try {
    return execSync(
      `docker inspect --format '{{.State.StartedAt}}' ${CONTAINER_NAME}`,
      { encoding: 'utf-8' }
    ).trim();
  } catch {
    return null;
  }
}

function formatUptime(startedAt) {
  const start = new Date(startedAt);
  const now = new Date();
  const diffMs = now - start;
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function prompt(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

function requireConfig() {
  const config = loadConfig();
  if (!config) {
    console.log('\n  No config found. Run "npx deepmine start" to set up first.\n');
    process.exit(1);
  }
  return config;
}

function requireDocker() {
  if (!checkDocker()) {
    printDockerInstallInstructions();
    process.exit(1);
  }
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function commandStart() {
  requireDocker();

  let config = loadConfig();

  // First-time setup
  if (!config) {
    console.log(BANNER);
    console.log('  Welcome! Let\'s get you set up for distributed mining.\n');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // New or returning user
    const isReturning = await prompt(rl, '  New user or returning? (N/r): ');
    const returning = isReturning.toLowerCase() === 'r';

    let username = '';
    let pin = '';

    if (returning) {
      // Returning user: verify credentials
      console.log('');
      while (!username) {
        const answer = await prompt(rl, '  Your username (e.g. bright.cave): ');
        if (answer.length > 0) {
          username = answer.trim().toLowerCase();
        }
      }
      while (!pin) {
        const answer = await prompt(rl, '  Your 6-digit PIN: ');
        if (/^\d{6}$/.test(answer)) {
          pin = answer;
        } else {
          console.log('  PIN must be exactly 6 digits.\n');
        }
      }

      // Verify with dashboard
      try {
        const res = await fetch(`${DEFAULT_DASHBOARD_URL}/api/auth/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, pin }),
        });
        const result = await res.json();
        if (!result.success) {
          console.log(`\n  Login failed: ${result.error || 'Invalid username or PIN.'}`);
          console.log('  Try again with "npx deepmine start".\n');
          rl.close();
          process.exit(1);
        }
        console.log(`\n  Welcome back, ${username}!`);
      } catch {
        console.log('\n  Could not connect to dashboard. Check your internet and try again.\n');
        rl.close();
        process.exit(1);
      }
    } else {
      // New user: generate a username
      username = generateUsername();
      while (RESERVED_USERNAMES.has(username)) {
        username = generateUsername();
      }

      console.log(`\n  Your username: ${username}\n`);
      let reroll = await prompt(rl, '  Press ENTER to keep, or R to re-roll: ');
      while (reroll.toLowerCase() === 'r') {
        username = generateUsername();
        while (RESERVED_USERNAMES.has(username)) {
          username = generateUsername();
        }
        console.log(`\n  Your username: ${username}\n`);
        reroll = await prompt(rl, '  Press ENTER to keep, or R to re-roll: ');
      }

      while (!pin) {
        const answer = await prompt(rl, '\n  Choose a 6-digit PIN (to recover your account later): ');
        if (/^\d{6}$/.test(answer)) {
          pin = answer;
        } else {
          console.log('  PIN must be exactly 6 digits.');
        }
      }

      // Register with dashboard
      try {
        const res = await fetch(`${DEFAULT_DASHBOARD_URL}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, pin }),
        });
        const result = await res.json();
        if (!result.success) {
          console.log(`\n  Registration failed: ${result.error || 'Unknown error.'}`);
          rl.close();
          process.exit(1);
        }
        console.log(`\n  Account created! Remember your PIN: ${pin}`);
        console.log('  You\'ll need it to recover your account on another computer.\n');
      } catch {
        console.log('\n  Could not connect to dashboard. Check your internet and try again.\n');
        rl.close();
        process.exit(1);
      }
    }

    // Mining mode
    console.log('\n  Choose mining mode:\n');
    console.log('    1. Lite      (' + TIERS.lite.size + ' download)  - ' + TIERS.lite.desc);
    console.log('    2. Standard  (' + TIERS.standard.size + ' download)  - ' + TIERS.standard.desc);
    console.log('    3. Full      (' + TIERS.full.size + ' download) - ' + TIERS.full.desc);
    console.log('');

    let tier = '';
    while (!tier) {
      const tierAnswer = await prompt(rl, '  Enter 1, 2, or 3 (default: 1): ');
      const choice = tierAnswer || '1';
      if (choice === '1') tier = 'lite';
      else if (choice === '2') tier = 'standard';
      else if (choice === '3') tier = 'full';
      else console.log('  Please enter 1, 2, or 3.\n');
    }

    // CPU cores
    const totalCores = os.cpus().length;
    const defaultCores = Math.floor(totalCores / 2);
    const coreAnswer = await prompt(
      rl,
      `\n  How many CPU cores to dedicate? (default: ${defaultCores} of ${totalCores}): `
    );
    const cpus = coreAnswer ? parseInt(coreAnswer, 10) : defaultCores;
    const validCpus = (cpus > 0 && cpus <= totalCores) ? cpus : defaultCores;

    rl.close();

    config = {
      username,
      pin,
      cpus: validCpus,
      tier,
      dashboard_url: DEFAULT_DASHBOARD_URL,
      container_name: CONTAINER_NAME,
      image: TIERS[tier].image,
      created_at: new Date().toISOString(),
    };
    saveConfig(config);
    console.log(`\n  Config saved to ${CONFIG_FILE}\n`);
  }

  // Check if already running - show full status instead of a dismissive message
  if (isContainerRunning()) {
    await commandStatus();
    return;
  }

  // Check if exists but stopped
  if (containerExists()) {
    console.log(`\n  Restarting stopped container "${CONTAINER_NAME}"...`);
    try {
      execSync(`docker start ${CONTAINER_NAME}`, { stdio: 'inherit' });
      printSuccessMessage(config);
      return;
    } catch (err) {
      console.error('  Failed to restart container:', err.message);
      process.exit(1);
    }
  }

  // Pull image (show progress)
  console.log(`\n  Pulling ${config.image} (${TIERS[config.tier]?.size || 'unknown size'})...`);
  const pull = spawnSync('docker', ['pull', config.image], { stdio: 'inherit' });
  if (pull.status !== 0) {
    console.error('\n  Failed to pull Docker image. Check your internet connection.');
    console.error(`  Image: ${config.image}\n`);
    process.exit(1);
  }

  // Run container
  console.log(`\n  Starting mining container (${config.tier} mode)...`);
  const userTZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const runArgs = [
    'run', '-d',
    '--name', CONTAINER_NAME,
    `--cpus=${config.cpus}`,
    '--restart=unless-stopped',
    '-e', `DEEPMINE_USERNAME=${config.username}`,
    '-e', `DEEPMINE_THREADS=${config.cpus}`,
    '-e', `DEEPMINE_DASHBOARD_URL=${config.dashboard_url}`,
    '-e', `TZ=${userTZ}`,
    '-v', `${VOLUME_NAME}:/data`,
    config.image,
  ];

  const run = spawnSync('docker', runArgs, { encoding: 'utf-8' });
  if (run.status !== 0) {
    console.error('\n  Failed to start container.');
    if (run.stderr) console.error(' ', run.stderr.trim());
    process.exit(1);
  }

  // Start Watchtower for auto-updates (checks every 6 hours)
  startWatchtower();

  printSuccessMessage(config);
}

function startWatchtower() {
  // Remove old watchtower if exists
  try {
    execSync(`docker rm -f ${WATCHTOWER_NAME}`, { stdio: 'ignore' });
  } catch { /* ignore */ }

  const wtArgs = [
    'run', '-d',
    '--name', WATCHTOWER_NAME,
    '--restart=unless-stopped',
    '-v', '/var/run/docker.sock:/var/run/docker.sock',
    'containrrr/watchtower',
    '--cleanup',
    '--interval', '21600',  // 6 hours
    '--label-enable',
    CONTAINER_NAME,         // only watch the miner container
  ];

  const wt = spawnSync('docker', wtArgs, { encoding: 'utf-8' });
  if (wt.status === 0) {
    console.log('  Auto-updates enabled (checks every 6 hours).');
  }
}

function printSuccessMessage(config) {
  console.log(`
  ╔══════════════════════════════════════════════════════════╗
  ║                                                          ║
  ║   Mining started!                                        ║
  ║   You're now contributing to antibiotic discovery.        ║
  ║                                                          ║
  ╚══════════════════════════════════════════════════════════╝

  Dashboard: ${config.dashboard_url}/user/${config.username}
  Status:    npx deepmine status
  Logs:      npx deepmine logs
  Stop:      npx deepmine stop
`);
}

async function commandStatus() {
  requireDocker();
  const config = requireConfig();

  const status = getContainerStatus();

  if (!status) {
    console.log(`\n  Container "${CONTAINER_NAME}" not found.`);
    console.log('  Run "npx deepmine start" to begin mining.\n');
    return;
  }

  console.log(`
  ╔══════════════════════════════════════════════════════════╗
  ║   DEEPMINE Miner                                         ║
  ╚══════════════════════════════════════════════════════════╝`);

  // Version check
  try {
    const localVersion = require('../package.json').version;
    const latestVersion = execSync('npm view deepmine version', {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (latestVersion && latestVersion !== localVersion) {
      console.log(`\n  Update available: ${localVersion} -> ${latestVersion}`);
      console.log('  Run: npm install -g deepmine@latest');
    }
  } catch { /* skip version check on error */ }

  if (status === 'running') {
    const startedAt = getContainerStartedAt();
    console.log(`
  Status:    RUNNING`);
    if (startedAt) {
      console.log(`  Uptime:    ${formatUptime(startedAt)}`);
    }
    console.log(`  Mode:      ${config.tier || 'lite'}`);
    console.log(`  CPUs:      ${config.cpus}`);
    console.log(`  Username:  ${config.username}`);

    // Step-by-step pipeline progress (SETI@Home style)
    const PIPELINE_STEPS = [
      { key: 'download',        label: 'Downloading reads' },
      { key: 'compress',        label: 'Compressing reads' },
      { key: 'assembly',        label: 'Assembling contigs' },
      { key: 'filter_contigs',  label: 'Filtering contigs' },
      { key: 'gene_calling',    label: 'Calling genes' },
      { key: 'gecco',           label: 'Detecting BGCs' },
    ];

    try {
      const logs = execSync(
        `docker logs --tail 50 ${CONTAINER_NAME} 2>&1`,
        { encoding: 'utf-8', timeout: 5000 }
      );
      const lines = logs.split('\n').filter(Boolean);

      // Find the current/most recent sample being processed
      let currentSampleId = null;
      let currentSampleEnv = null;
      for (let i = lines.length - 1; i >= 0; i--) {
        const procMatch = lines[i].match(/Processing (\S+)\s*(?:\(environment:\s*([^)]+)\))?/);
        if (procMatch) {
          currentSampleId = procMatch[1];
          currentSampleEnv = procMatch[2] || null;
          break;
        }
        const selMatch = lines[i].match(/Selected accession (\S+)/);
        if (selMatch) {
          currentSampleId = selMatch[1];
          break;
        }
      }

      // Count session-wide completed and skipped samples
      const samplesCompleted = lines.filter(l => /Cycle \d+\s*complete/i.test(l)).length;
      const samplesSkipped = lines.filter(l => /skipped/i.test(l)).length;

      // If we found a current sample, parse its step progress
      if (currentSampleId) {
        // Collect log lines for this sample (from "Processing SRR..." onward)
        let sampleLines = [];
        let found = false;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(`Processing ${currentSampleId}`)) {
            found = true;
            sampleLines = [];
          }
          if (found) {
            sampleLines.push(lines[i]);
          }
        }

        // Check if this sample already finished (completed or skipped)
        const sampleDone = sampleLines.some(l =>
          /Cycle \d+\s*complete/i.test(l) || /Cycle \d+:.*skipped/i.test(l)
        );

        if (sampleDone) {
          // Between samples, waiting for next
          console.log('\n  --- Current Sample ---');
          console.log('  Selecting next sample...');
        } else {
          // Build step status from sample lines
          const stepStatus = {};  // key -> { state: 'done'|'running', time: string|null }

          for (const line of sampleLines) {
            // Match: [step_key] Starting: ...
            const startMatch = line.match(/\[(\w+)\]\s*Starting:/);
            if (startMatch) {
              const key = startMatch[1];
              stepStatus[key] = { state: 'running', time: null };
            }
            // Match: [step_key] Completed in Xs
            const doneMatch = line.match(/\[(\w+)\]\s*Completed in\s*([0-9.]+)s/);
            if (doneMatch) {
              const key = doneMatch[1];
              stepStatus[key] = { state: 'done', time: doneMatch[2] + 's' };
            }
          }

          const sampleLabel = currentSampleEnv
            ? `${currentSampleId} (${currentSampleEnv})`
            : currentSampleId;

          console.log('\n  --- Current Sample ---');
          console.log(`  ${sampleLabel}`);
          console.log('');

          // Render each pipeline step
          for (let i = 0; i < PIPELINE_STEPS.length; i++) {
            const step = PIPELINE_STEPS[i];
            const num = `[${i + 1}/${PIPELINE_STEPS.length}]`;
            const info = stepStatus[step.key];
            const label = step.label.padEnd(22);

            if (info && info.state === 'done') {
              // Green checkmark + time
              console.log(`  ${num} ${label} \x1b[32mdone\x1b[0m (${info.time})`);
            } else if (info && info.state === 'running') {
              // Yellow running indicator
              console.log(`  ${num} ${label} \x1b[33mrunning...\x1b[0m`);
            } else {
              // Gray pending
              console.log(`  ${num} ${label} \x1b[90mpending\x1b[0m`);
            }
          }
        }
      } else {
        // No sample found in recent logs
        console.log('\n  --- Current Sample ---');
        console.log('  Selecting next sample...');
      }

      // Session summary
      if (samplesCompleted > 0 || samplesSkipped > 0) {
        console.log(`\n  Samples this session: ${samplesCompleted} completed, ${samplesSkipped} skipped`);
      }
    } catch { /* ignore log errors */ }

    // Fetch user stats from dashboard
    const statsUrl = `${config.dashboard_url}/api/user/${config.username}`;
    try {
      const response = await fetch(statsUrl);
      if (response.ok) {
        const raw = await response.json();
        const d = raw.user || raw;
        const totalRuns = d.total_runs || 0;
        const totalBgcs = d.total_bgcs || 0;
        const totalNovel = d.total_novel || 0;
        const bestScore = d.best_score || 0;

        if (totalRuns === 0 && totalBgcs === 0) {
          console.log('\n  --- Lifetime Stats ---');
          console.log('  No completed runs yet. Your first results will appear');
          console.log('  here once a sample finishes processing (15-60 min).');
          console.log('  The pipeline is working, just keep it running!');
        } else {
          console.log('\n  --- Lifetime Stats ---');
          console.log(`  Runs completed:      ${totalRuns.toLocaleString()}`);
          console.log(`  BGCs found:          ${totalBgcs.toLocaleString()}`);
          console.log(`  Novel discoveries:   ${totalNovel.toLocaleString()}`);
          console.log(`  Best score:          ${bestScore}`);
        }
      }
    } catch { /* silently skip if dashboard unreachable */ }

    console.log(`\n  Dashboard: ${config.dashboard_url}/user/${config.username}`);
    console.log(`  Logs:      npx deepmine logs`);
    console.log(`  Stop:      npx deepmine stop`);
  } else {
    console.log(`\n  Status: ${status.toUpperCase()}`);
    console.log('  Run "npx deepmine start" to resume.');
  }

  console.log('');
}

function commandStop() {
  requireDocker();

  if (!containerExists()) {
    console.log(`\n  Container "${CONTAINER_NAME}" not found. Nothing to stop.\n`);
    return;
  }

  if (!isContainerRunning()) {
    console.log(`\n  Container "${CONTAINER_NAME}" is already stopped.\n`);
    return;
  }

  console.log(`\n  Stopping ${CONTAINER_NAME}...`);
  try {
    execSync(`docker stop ${CONTAINER_NAME}`, { stdio: 'ignore' });
    try { execSync(`docker stop ${WATCHTOWER_NAME}`, { stdio: 'ignore' }); } catch { /* ignore */ }
    console.log('\n  Mining paused. Your contributions are saved.');
    console.log('  Run "npx deepmine start" to resume.\n');
  } catch (err) {
    console.error('  Failed to stop container:', err.message);
    process.exit(1);
  }
}

function commandLogs() {
  requireDocker();

  if (!containerExists()) {
    console.log(`\n  Container "${CONTAINER_NAME}" not found.`);
    console.log('  Run "npx deepmine start" to begin mining.\n');
    process.exit(1);
  }

  console.log(`  Streaming logs from ${CONTAINER_NAME} (Ctrl+C to exit)...\n`);
  const child = spawn('docker', ['logs', '--tail', '100', '-f', CONTAINER_NAME], {
    stdio: 'inherit',
  });

  child.on('error', (err) => {
    console.error('  Failed to stream logs:', err.message);
    process.exit(1);
  });

  process.on('SIGINT', () => {
    child.kill('SIGINT');
    process.exit(0);
  });
}

function commandDashboard() {
  const config = requireConfig();
  const url = `${config.dashboard_url}/user/${config.username}`;

  console.log(`\n  Opening dashboard: ${url}\n`);

  const platform = process.platform;
  let cmd, cmdArgs;

  if (platform === 'darwin') {
    cmd = 'open';
    cmdArgs = [url];
  } else if (platform === 'win32') {
    cmd = 'cmd';
    cmdArgs = ['/c', 'start', url];
  } else {
    cmd = 'xdg-open';
    cmdArgs = [url];
  }

  try {
    spawnSync(cmd, cmdArgs, { stdio: 'ignore' });
  } catch {
    console.log(`  Could not open browser. Visit manually: ${url}\n`);
  }
}

function commandUpdate() {
  requireDocker();
  const config = requireConfig();

  // Pull latest image
  console.log(`\n  Pulling latest ${config.image}...`);
  const pull = spawnSync('docker', ['pull', config.image], { stdio: 'inherit' });
  if (pull.status !== 0) {
    console.error('\n  Failed to pull image. Check your internet connection.\n');
    process.exit(1);
  }

  // Stop and remove old container if it exists
  if (containerExists()) {
    console.log(`\n  Stopping and removing old container...`);
    try {
      if (isContainerRunning()) {
        execSync(`docker stop ${CONTAINER_NAME}`, { stdio: 'ignore' });
      }
      execSync(`docker rm ${CONTAINER_NAME}`, { stdio: 'ignore' });
    } catch {
      // Ignore errors during cleanup
    }
  }

  // Start new container with same config
  console.log('  Starting updated container...');
  const userTZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const runArgs = [
    'run', '-d',
    '--name', CONTAINER_NAME,
    `--cpus=${config.cpus}`,
    '--restart=unless-stopped',
    '-e', `DEEPMINE_USERNAME=${config.username}`,
    '-e', `DEEPMINE_THREADS=${config.cpus}`,
    '-e', `DEEPMINE_DASHBOARD_URL=${config.dashboard_url}`,
    '-e', `TZ=${userTZ}`,
    '-v', `${VOLUME_NAME}:/data`,
    config.image,
  ];

  const run = spawnSync('docker', runArgs, { encoding: 'utf-8' });
  if (run.status !== 0) {
    console.error('\n  Failed to start updated container.');
    if (run.stderr) console.error(' ', run.stderr.trim());
    process.exit(1);
  }

  console.log('\n  Updated successfully! Mining resumed with latest image.\n');
}

async function commandReset() {
  requireDocker();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await prompt(
    rl,
    '\n  This will stop mining and remove all config. Are you sure? (yes/no): '
  );
  rl.close();

  if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
    console.log('  Cancelled.\n');
    return;
  }

  // Stop and remove containers
  if (containerExists()) {
    console.log(`\n  Stopping and removing containers...`);
    try {
      if (isContainerRunning()) {
        execSync(`docker stop ${CONTAINER_NAME}`, { stdio: 'ignore' });
      }
      execSync(`docker rm ${CONTAINER_NAME}`, { stdio: 'ignore' });
      try {
        execSync(`docker stop ${WATCHTOWER_NAME}`, { stdio: 'ignore' });
        execSync(`docker rm ${WATCHTOWER_NAME}`, { stdio: 'ignore' });
      } catch { /* ignore */ }
      console.log('  Containers removed.');
    } catch (err) {
      console.error('  Warning: Could not fully remove containers:', err.message);
    }
  } else {
    console.log('\n  No container found.');
  }

  // Remove config
  if (fs.existsSync(CONFIG_FILE)) {
    fs.unlinkSync(CONFIG_FILE);
    console.log('  Config removed.');
  }

  console.log('\n  Reset complete. Run "npx deepmine start" to set up again.\n');
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  switch (command) {
    case 'start':
      await commandStart();
      break;
    case 'status':
      await commandStatus();
      break;
    case 'stop':
      commandStop();
      break;
    case 'logs':
      commandLogs();
      break;
    case 'dashboard':
      commandDashboard();
      break;
    case 'update':
      commandUpdate();
      break;
    case 'reset':
      await commandReset();
      break;
    case 'pin':
    case 'showpin':
      commandShowPin();
      break;
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      break;
    default:
      console.log(`\n  Unknown command: ${command}`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('  Error:', err.message);
  process.exit(1);
});
