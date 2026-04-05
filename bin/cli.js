#!/usr/bin/env node

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const DASHBOARD_DIR = path.join(__dirname, '..', 'dashboard');
const args = process.argv.slice(2);
const command = args[0] || 'start';

const HELP = `
  deepmine - Mine Earth's microbiome for new antibiotics

  Usage:
    npx deepmine                  Start the community dashboard (port 6767)
    npx deepmine start            Same as above
    npx deepmine start --port N   Start on a custom port
    npx deepmine seed             Seed the dashboard with demo data
    npx deepmine status           Check if the dashboard is running
    npx deepmine pipeline         Show how to install the analysis pipeline

  The dashboard tracks community contributions to antibiotic discovery.
  Run the analysis pipeline separately to find novel biosynthetic gene clusters.

  GitHub: https://github.com/skibidiskib/deepmine
`;

function ensureDeps() {
  const nodeModules = path.join(DASHBOARD_DIR, 'node_modules');
  if (!fs.existsSync(nodeModules)) {
    console.log('Installing dashboard dependencies...');
    execSync('npm install --omit=dev', { cwd: DASHBOARD_DIR, stdio: 'inherit' });
  }
}

function startDashboard() {
  const portArg = args.indexOf('--port');
  const port = portArg !== -1 && args[portArg + 1] ? args[portArg + 1] : '6767';

  ensureDeps();

  console.log(`
  ╔══════════════════════════════════════════════════╗
  ║                                                  ║
  ║   DEEPMINE Community Dashboard                   ║
  ║   Mining Earth's microbiome for new antibiotics   ║
  ║                                                  ║
  ║   Starting on http://localhost:${port.padEnd(5)}             ║
  ║                                                  ║
  ╚══════════════════════════════════════════════════╝
  `);

  const child = spawn('npx', ['next', 'dev', '-p', port], {
    cwd: DASHBOARD_DIR,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' },
  });

  child.on('error', (err) => {
    if (err.code === 'ENOENT') {
      console.error('Error: Node.js is required. Install from https://nodejs.org');
    } else {
      console.error('Error starting dashboard:', err.message);
    }
    process.exit(1);
  });

  process.on('SIGINT', () => {
    child.kill('SIGINT');
    process.exit(0);
  });
}

function seedDashboard() {
  const portArg = args.indexOf('--port');
  const port = portArg !== -1 && args[portArg + 1] ? args[portArg + 1] : '6767';
  const url = `http://localhost:${port}/api/seed`;

  console.log(`Seeding demo data to ${url}...`);

  fetch(url, { method: 'POST' })
    .then((r) => r.json())
    .then((data) => {
      if (data.success) {
        console.log(`Seeded: ${data.users_created} users, ${data.runs_created} runs, ${data.discoveries_created} discoveries`);
      } else {
        console.error('Seed failed:', data.error || 'Unknown error');
      }
    })
    .catch(() => {
      console.error(`Cannot connect to dashboard at localhost:${port}. Is it running?`);
      console.error('Start it first: npx deepmine start');
    });
}

function checkStatus() {
  const port = '6767';
  fetch(`http://localhost:${port}/api/stats`)
    .then((r) => r.json())
    .then((data) => {
      console.log('Dashboard is running on http://localhost:' + port);
      console.log(`  BGCs: ${data.total_bgcs?.toLocaleString() || 0}`);
      console.log(`  Novel: ${data.total_novel?.toLocaleString() || 0}`);
      console.log(`  Contributors: ${data.total_users || 0}`);
      console.log(`  Environments: ${data.total_environments || 0}`);
    })
    .catch(() => {
      console.log('Dashboard is not running.');
      console.log('Start it with: npx deepmine start');
    });
}

function showPipelineInfo() {
  console.log(`
  DEEPMINE Analysis Pipeline
  ========================

  The pipeline finds novel biosynthetic gene clusters in metagenomic data.
  It requires Python and bioinformatics tools.

  Install:
    # 1. Install Python dependencies
    cd pipeline
    pip install -e .

    # 2. Install bioinformatics tools via conda
    conda install -c bioconda megahit prodigal antismash gecco deepbgc seqkit sra-tools

  Run:
    # Download a sample
    deepmine fetch --sra SRR8859675

    # Run the pipeline
    deepmine run -j 8

    # Report results to the dashboard
    deepmine report results/ --url http://localhost:6767 --username your_name

  See pipeline/README.md for full documentation.
  `);
}

switch (command) {
  case 'start':
  case undefined:
    startDashboard();
    break;
  case 'seed':
    seedDashboard();
    break;
  case 'status':
    checkStatus();
    break;
  case 'pipeline':
    showPipelineInfo();
    break;
  case 'help':
  case '--help':
  case '-h':
    console.log(HELP);
    break;
  default:
    console.log(`Unknown command: ${command}`);
    console.log(HELP);
    process.exit(1);
}
