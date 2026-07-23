#!/usr/bin/env node

// Ensure node 20 at least
const [major] = process.versions.node.split('.').map(Number);
if (major < 20) {
    console.error('❌ Node.js version 20 or higher is required to run this script.');
    process.exit(1);
}

// Dependencies
import {program} from 'commander';
import inquirer from 'inquirer';
import fs from 'fs-extra';
import fsCore from 'fs';
import {execSync, spawn} from 'child_process';
import path from 'path';
import {fileURLToPath} from 'url';
import cliProgress from 'cli-progress';
import crypto from 'crypto';
import pg from "pg";
import mysql from "mysql2/promise";

// Utils and data
import {gatherFileUploadSettings, insertFileUploadConfiguration} from './utils/fileUploadConfig.js';
import autoUpdate from './auto-update.cjs';
import packageJson from './package.json' with {type: 'json'};
import coreVersionInfo from './core-version.json' with {type: 'json'};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The library version to pin in scaffolded projects. Baked from the repo's
// root package.json at release/build time (see scripts/sync-cli-core-version.mjs)
// so it tracks the library automatically instead of being hardcoded.
const CORE_VERSION = coreVersionInfo.version;

const subcommand = process.argv[2];

// ─── Auto-update (phase 1): apply a pending update, then re-exec ──────
//
// A previous invocation may have detected a newer CLI version and staged
// it (see the background check near the bottom of this file). Install it
// now — foreground, output captured to ~/.appx-core/last-install.log —
// BEFORE any command work, then re-exec into the freshly installed
// binary so the user's command runs the new code. Deferring the install
// to a later invocation (rather than a background `npm install -g` in
// the running process) avoids rewriting the package directory while it's
// being read. Skipped inside the re-exec'd child, for `appx-core update`
// (which installs directly), and when disabled via env.
if (
    !process.env[autoUpdate.REEXEC_ENV_FLAG] &&
    process.env[autoUpdate.ENV_DISABLE] !== '1' &&
    subcommand !== 'update'
) {
    const result = await autoUpdate.applyPendingUpdate({
        packageName: packageJson.name,
        currentVersion: packageJson.version,
    });
    if (result.applied && result.succeeded) {
        const child = spawn(process.argv[0], [process.argv[1], ...process.argv.slice(2)], {
            stdio: 'inherit',
            env: {...process.env, [autoUpdate.REEXEC_ENV_FLAG]: '1'},
        });
        child.on('exit', (code) => process.exit(code ?? 0));
        child.on('error', () => process.exit(1));
        await new Promise(() => {}); // hand the terminal to the child; never resolves
    }
}

const phaseDurations = {
    installDependencies: 30,
    setupProjectStructure: 5,
    createPrismaMigration: 5,
    generateCoreModels: 10,
    gitInit: 1,
    migrateDatabase: 5,
    fileUploadSetup: 5
};

const calculateTotalETA = () => {
    return Object.values(phaseDurations).reduce((acc, curr) => acc + curr, 0);
};

const logo = `\x1b[36m
      _       _______  _______  ____  ____
     / \\     |_   __ \\|_   __ \\|_  _||_  _|
    / _ \\      | |__) | | |__) | \\ \\  / /
   / ___ \\     |  ___/  |  ___/   > \`' <
 _/ /   \\ \\_  _| |_    _| |_    _/ /'\\ \\_
|____| |____||_____|  |_____|  |____||____|
\x1b[0m
CLI Version: ${packageJson.version}
`;

console.log(logo);
program.version(packageJson.version).description('AppX Core Project Initialization Wizard');
let progressBar;
let remainingETA = 0;
program
    .command('create')
    .description('Create a new AppX Core project')
    .action(() => {
        console.log('Starting AppX Core...');
        promptUser();
    });

function coreGenerate(showOutput) {
    // run file inside node_modules/appx-core/dist/config/generate-all.js
    const generatePath = path.join(process.cwd(), 'node_modules', '@appxdigital/appx-core', 'dist', 'config', 'generate-all.js');
    if (!fsCore.existsSync(generatePath)) {
        console.error('❌ Not inside a valid AppX Core project directory. Please run this command inside your project directory.');
        process.exit(1);
    }
    // Execute the script
    try {
        executeCommand(`node ${generatePath}`, showOutput);
        console.log('✅ Prisma client and GraphQL schema generated successfully.');
    } catch (error) {
        console.error('❌ An error occurred while generating Prisma client and GraphQL schema:', error.message);
        process.exit(1);
    }
}

function coreGenerateModels(names, options) {
    // run the wizard inside node_modules/@appxdigital/appx-core/dist/config/generate-models.js
    const scriptPath = path.join(process.cwd(), 'node_modules', '@appxdigital/appx-core', 'dist', 'config', 'generate-models.js');
    if (!fsCore.existsSync(scriptPath)) {
        console.error('❌ Not inside a valid AppX Core project directory. Please run this command inside your project directory.');
        process.exit(1);
    }
    const argv = [...(names || [])];
    if (options?.all) argv.push('--all');
    try {
        // stdio inherit so the interactive picker (when no names/--all) works.
        execSync(`node ${scriptPath} ${argv.join(' ')}`.trim(), {stdio: 'inherit'});
    } catch (error) {
        console.error('❌ An error occurred while generating modules:', error.message);
        process.exit(1);
    }
}

const generateCommand = program.command('generate')
    .description('Regenerate deploy-safe artifacts (Prisma client, GraphQL types, DTO bases). No code changes.')
    .action(() => {
        coreGenerate(true);
    });

generateCommand
    .command('models [names...]')
    .description('Scaffold CRUD modules (module/service/controller/resolver/DTO) for selected models and register them in AppModule. Interactive picker when no names are given.')
    .option('--all', 'Scaffold every generatable model (legacy behaviour)')
    .action((names, options) => {
        coreGenerateModels(names, options);
    });

program.command('setup:fileupload')
    .description('Add file upload configuration to the project')
    .action(() => {
        // run file inside node_modules/appx-core/dist/config/setup-fileupload.js
        const generatePath = path.join(process.cwd(), 'node_modules', '@appxdigital/appx-core', 'dist', 'config', 'setup-fileupload.js');
        if (!fsCore.existsSync(generatePath)) {
            console.error('❌ Not inside a valid AppX Core project directory. Please run this command inside your project directory.');
            process.exit(1);
        }
        // Execute the script
        try {
            execSync(`node ${generatePath}`, {stdio: 'inherit'});
            console.log('✅ File upload configuration added successfully.');
        } catch (error) {
            console.error('❌ An error occurred while adding file upload configuration:', error.message);
            process.exit(1);
        }
    });

async function checkDb(config) {
    const {dbProvider, dbHost, dbPort, dbUser, dbPassword, dbName} = config;

    if (dbProvider === "mysql") {
        const conn = await mysql.createConnection({
            host: dbHost,
            port: Number(dbPort),
            user: dbUser,
            password: dbPassword,
            // Important: don't set database here yet; we first check it exists
            connectTimeout: 5000,
        });

        try {
            // 1) DB exists?
            const [dbRows] = await conn.query(
                "SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?",
                [dbName]
            );

            if (dbRows.length === 0) {
                return {ok: false, reason: `Database "${dbName}" does not exist.`};
            }

            // 2) Any tables?
            const [tableRows] = await conn.query(
                "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? LIMIT 1",
                [dbName]
            );

            if (tableRows.length > 0) {
                return {ok: false, reason: `Database "${dbName}" is not empty (has tables).`};
            }

            return {ok: true};
        } finally {
            await conn.end();
        }
    }

    if (dbProvider === "postgresql") {
        const client = new pg.Client({
            host: dbHost,
            port: Number(dbPort),
            user: dbUser,
            password: dbPassword,
            database: "postgres", // connect to a known db first to check existence
            connectionTimeoutMillis: 5000,
        });

        await client.connect();
        try {
            // 1) DB exists?
            const dbRes = await client.query(
                "SELECT 1 FROM pg_database WHERE datname = $1",
                [dbName]
            );
            if (dbRes.rowCount === 0) {
                return {ok: false, reason: `Database "${dbName}" does not exist.`};
            }

            // 2) Connect to target db and check tables in public schema (and others if you want)
            const client2 = new pg.Client({
                host: dbHost,
                port: Number(dbPort),
                user: dbUser,
                password: dbPassword,
                database: dbName,
                connectionTimeoutMillis: 5000,
            });

            await client2.connect();
            try {
                const tableRes = await client2.query(
                    `
                        SELECT 1
                        FROM information_schema.tables
                        WHERE table_type = 'BASE TABLE'
                          AND table_schema NOT IN ('pg_catalog', 'information_schema') LIMIT 1
                    `
                );

                if (tableRes.rowCount > 0) {
                    return {ok: false, reason: `Database "${dbName}" is not empty (has tables).`};
                }

                return {ok: true};
            } finally {
                await client2.end();
            }
        } finally {
            await client.end();
        }
    }

    return {ok: false, reason: "Unsupported dbProvider."};
}

async function promptDbConfig() {
    return inquirer.prompt([
        {
            type: "list",
            name: "dbProvider",
            message: "Database provider:",
            choices: ["mysql", "postgresql"],
            default: "mysql",
        },
        {
            type: "input",
            name: "dbHost",
            message: "Database Host:",
            default: "127.0.0.1",
        },
        {
            type: "input",
            name: "dbPort",
            message: "Database Port:",
            default: (answers) => (answers.dbProvider === "mysql" ? "3306" : "5432"),
            validate: (v) => (!Number.isNaN(Number(v)) ? true : "Port must be a number"),
        },
        {
            type: "input",
            name: "dbUser",
            message: "Database User:",
            default: "root",
        },
        {
            type: "password",
            name: "dbPassword",
            message: "Database Password:",
            mask: "*",
        },
        {
            type: "input",
            name: "dbName",
            message: "Database Name:",
            default: "generic",
        },
    ]);
}

async function promptDbUntilValid() {
    while (true) {
        const dbConfig = await promptDbConfig();

        try {
            const result = await checkDb(dbConfig);

            if (result.ok) {
                return dbConfig;
            }

            process.stdout.write(`❌ Database check failed: ${result.reason}\n`);
        } catch (err) {
            process.stdout.write(`❌ Database check failed: ${err.message}\n`);
        }

        const {retry} = await inquirer.prompt([
            {
                type: "confirm",
                name: "retry",
                message: "Re-enter all database settings?",
                default: true,
            },
        ]);

        if (!retry) {
            throw new Error("User aborted database configuration.");
        }
    }
}

async function promptUser() {
    let fileUploadConfigData = {};
    try {
        const baseAnswers = await inquirer.prompt([
            {
                type: "input",
                name: "projectName",
                message: "Project name:",
                default: "nestjs-project",
            },
        ]);

        const dbAnswers = await promptDbUntilValid();

        const rest = await inquirer.prompt([
            {
                type: "confirm",
                name: "showOutput",
                message: "Show installation output?",
                default: false,
            },
            {
                type: "confirm",
                name: "configureFileUpload",
                message: "Configure file upload?",
                default: false,
            },
        ]);

        const answers = {...baseAnswers, ...dbAnswers, ...rest};

        if (answers.configureFileUpload) {
            fileUploadConfigData = await gatherFileUploadSettings();
        }

        remainingETA = calculateTotalETA();
        createProject(answers, fileUploadConfigData);
    } catch (error) {
        console.error('Error prompting user:', error);
    }
}

async function createProject(answers, fileUploadConfigData) {
    const {projectName, showOutput, backoffice} = answers;

    console.log(`Creating project: ${projectName}`);

    // If current directory is empty, use it as project directory
    let projectPath = process.cwd();

    // Ignore DS_STORE files when checking if directory is empty
    if (fs.readdirSync(projectPath).filter(f => f.toLowerCase() !== '.DS_STORE').length > 0) {
        projectPath += `/${projectName.replace(/\s+/g, '_').toLowerCase()}`;
    }

    console.log(`Project path: ${projectPath}`);

    const project_config = {
        DB_PROVIDER: answers.dbProvider === 'mysql' ? 'mysql' : 'postgresql',
        DB_HOST: answers.dbHost,
        DB_PORT: answers.dbPort,
        DB_USER: answers.dbUser,
        DB_PASSWORD: answers.dbPassword,
        DB_NAME: answers.dbName,
        SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
        SESSION_COOKIE_NAME: 'session_' + projectName.replace(/\s+/g, '_').toLowerCase(),
        JWT_SECRET: crypto.randomBytes(32).toString('hex'),
        JWT_REFRESH_SECRET: crypto.randomBytes(32).toString('hex'),
    }

    if (!showOutput) {
        const phases = backoffice ? 8 : 7;
        progressBar = new cliProgress.SingleBar(
            {
                format: `\x1b[36m{bar}\x1b[0m {percentage}% | ETA: {remainingETA}s | {value}/{total}`,
                barCompleteChar: '\u2588',
                barIncompleteChar: '\u2591'
            },
            cliProgress.Presets.shades_classic
        );
        progressBar.update(0, {remainingETA});
        progressBar.start(phases, 0);
    }

    try {
        fs.ensureDirSync(projectPath);

        // Directory must be empty
        if (fs.readdirSync(projectPath).filter(f => f.toLowerCase() !== '.DS_STORE').length > 0) {
            console.error('🚫 The target directory is not empty. Please choose an empty directory or remove existing files. Check for hidden files as well.');
            process.exit(1);
        }

        process.chdir(projectPath);

        // TODO test database connection here and exit if it fails


        // Install dependencies
        createPackageJson(projectPath, projectName);
        executeCommand('npm --logevel=error install', answers.showOutput);
        incrementProgress(answers?.showOutput, "installDependencies");

        // Update PATH to include local node_modules/.bin
        const localBinPath = path.join(projectPath, 'node_modules', '.bin');
        process.env.PATH = `${localBinPath}${path.delimiter}${process.env.PATH}`;

        // Create Core project structure
        setupProjectStructure(projectPath, project_config);

        // Create .gitignore
        await createGitignore(projectPath);

        // Create tsconfig.json and tsconfig.build.json
        createTsConfig(projectPath);

        incrementProgress(answers?.showOutput, "setupProjectStructure");

        // Create prisma migration file
        executeCommand(`prisma migrate dev --name init --create-only`, answers?.showOutput);
        incrementProgress(answers?.showOutput, "createPrismaMigration");

        // Generate Core Models
        coreGenerate(answers?.showOutput);
        incrementProgress(answers?.showOutput, "generateCoreModels");

        if (fileUploadConfigData.provider) {
            await insertFileUploadConfiguration(fileUploadConfigData, projectPath);
            incrementProgress(showOutput, "fileUploadSetup");
        }

        // Format code
        executeCommand('npx --yes prettier --write .', answers?.showOutput);

        // Create git repo and initial commit
        initializeGitRepo(projectPath, answers?.showOutput);
        incrementProgress(answers?.showOutput, "gitInit");

        // Migrate database
        executeCommand(`prisma migrate dev`, answers?.showOutput);

        incrementProgress(answers?.showOutput, "migrateDatabase");

        if (!showOutput) {
            progressBar.stop();
        }
        console.log('Project created successfully!');

    } catch (error) {
        console.error('❌ An error occurred during project creation:', error.message);
        if (fs.existsSync(projectPath)) {
            //console.log('🧹 Cleaning up incomplete project files...');
            //fs.removeSync(projectPath);
        }
        console.error('🚫 Project creation aborted due to the above error.');
        if (!showOutput && progressBar) {
            progressBar.stop();
        }
        process.exit(1);
    }
}

/**
 * The `@appxdigital/appx-core` dependency spec to write into a scaffolded
 * project, matched to THIS CLI's release channel: a beta CLI pins the beta
 * library, a production CLI pins the production library.
 *
 * The baked `CORE_VERSION` is the library version from the repo at build time.
 * When its channel matches the CLI's, we pin it exactly (reproducible). When it
 * doesn't (e.g. a beta CLI built while the repo's library was on a production
 * version), we fall back to the channel's dist-tag so the project still gets the
 * right channel — never a production project depending on a prerelease.
 */
function coreDependencySpec() {
    const cliChannel = autoUpdate.inferChannel(packageJson.version);
    const coreChannel = autoUpdate.inferChannel(CORE_VERSION);
    if (cliChannel === 'beta') {
        return coreChannel === 'beta' ? CORE_VERSION : 'beta';
    }
    return coreChannel === 'beta' ? 'latest' : CORE_VERSION;
}

function createPackageJson(projectPath, projectName) {
    const packageJsonContent = {
        name: projectName,
        version: "0.0.1",
        description: "",
        author: "Powered by AppX Digital",
        private: true,
        license: "UNLICENSED",
        scripts: {
            "build": "nest build",
            "start": "cross-env NODE_ENV=development nest start",
            "start:dev": "cross-env NODE_ENV=development nest start --watch",
            "start:prod": "cross-env NODE_ENV=production node dist/main",
            "lint": "eslint \"{src,apps,libs,test}/**/*.ts\" --fix",
            "db-pull": "npm run db-pull --prefix ./node_modules/appx-core"
        },
        dependencies: {
            "@appxdigital/appx-core": coreDependencySpec(),
        },
        devDependencies: {
            "@nestjs/cli": "~11.0.0",
            "cross-env": "~10.1.0",
        },
        engines: {
            "node": ">=20.0.0"
        }
    };

    fs.writeJsonSync(path.join(projectPath, 'package.json'), packageJsonContent, {spaces: 2});
}

function setupProjectStructure(projectPath, project_config) {
    // Create scaffold files from scaffold directory recursively, replacing placeholders from *.template files
    const scaffoldDir = path.join(__dirname, 'scaffold');

    function copyAndReplaceTemplates(srcDir, destDir) {
        fs.readdirSync(srcDir).forEach((item) => {
            const srcPath = path.join(srcDir, item);
            let destPath = path.join(destDir, item.replace('.template', ''));
            const stats = fs.statSync(srcPath);
            if (stats.isDirectory()) {
                fs.ensureDirSync(destPath);
                copyAndReplaceTemplates(srcPath, destPath);
            } else {
                let content = fs.readFileSync(srcPath, 'utf-8');

                // Replace placeholders
                for (const [key, value] of Object.entries(project_config)) {
                    const placeholder = `{{${key}}}`;
                    content = content.replace(new RegExp(placeholder, 'g'), value);
                }
                fs.writeFileSync(destPath, content, 'utf-8');
            }
        });
    }

    copyAndReplaceTemplates(scaffoldDir, projectPath);
}

function initializeGitRepo(projectPath, showOutput = false) {
    // If git is installed in the system, initialize a git repository and make the initial commit
    let installed = true;
    try {
        execSync('git --version', {stdio: 'ignore'});
    } catch (error) {
        console.log('Git is not installed. Skipping git initialization.');
        return;
    }

    try {
        executeCommand('git init', showOutput);
        executeCommand('git add .', showOutput);
        executeCommand('git commit -m "Project init"', showOutput);
    } catch (error) {
        console.error("Failed to initialize git repository or make the initial commit:", error);
        throw error;
    }
}

async function createGitignore(projectPath) {
    const envFilesToAdd = ['.env', '.env.production', 'src/generated/**', 'tmp'];

    const {defaultGitIgnore} = await import(path.join(projectPath, 'node_modules', '@nestjs/cli/lib/configuration/defaults.js'));
    const existingLines = defaultGitIgnore.split('\n');
    const updatedLines = new Set(existingLines);
    envFilesToAdd.forEach((file) => {
        if (!existingLines.includes(file)) {
            updatedLines.add(file);
        }
    });
    const finalContent = Array.from(updatedLines).join('\n').trim() + '\n';

    const gitignorePath = path.join(projectPath, '.gitignore');
    fs.writeFileSync(gitignorePath, finalContent, 'utf-8');
}

function createTsConfig(projectPath) {
    let tsConfig = fs.readFileSync(path.join(projectPath, 'node_modules/@nestjs/schematics/dist/lib/application/files/ts/tsconfig.json'), 'utf-8');
    // Replace '<%= strict %>' with 'false'
    tsConfig = tsConfig.replaceAll("<%= strict %>", 'false');

    let tsConfigBuild = fs.readFileSync(path.join(projectPath, 'node_modules/@nestjs/schematics/dist/lib/application/files/ts/tsconfig.build.json'), 'utf-8');

    // Ensure target is ES2017
    tsConfig = JSON.parse(tsConfig);
    if (!tsConfig.compilerOptions) {
        tsConfig.compilerOptions = {};
    }
    tsConfig.compilerOptions.target = 'ES2017';
    tsConfig = JSON.stringify(tsConfig, null, 2);

    fs.writeFileSync(path.join(projectPath, 'tsconfig.json'), tsConfig);
    fs.writeFileSync(path.join(projectPath, 'tsconfig.build.json'), tsConfigBuild);
}


function incrementProgress(showOutput, phase) {
    if (!showOutput) {
        remainingETA -= phaseDurations[phase];
        progressBar.update(progressBar.value + phase === 'end' ? 0 : 1, {remainingETA});
    }
}

function executeCommand(command, showOutput = answers?.showOutput) {
    const options = showOutput ? {stdio: 'inherit'} : {stdio: 'ignore'};
    try {
        execSync(command, options);
    } catch (error) {
        console.error(`Failed to execute command: ${command}`, error);
        throw error;
    }
}

program.command('update')
    .description('Update the appx-core CLI to the latest version on your release channel (beta stays beta).')
    .option('--channel <channel>', 'Install from a specific channel: beta | production')
    .action(async (options) => {
        const channel = options.channel === 'beta' || options.channel === 'production'
            ? options.channel
            : undefined;
        if (options.channel && !channel) {
            console.error('❌ --channel must be "beta" or "production".');
            process.exit(1);
        }
        await autoUpdate.runUpdate(
            {channel},
            {packageName: packageJson.name, currentVersion: packageJson.version},
        );
    });

// ─── Auto-update (phase 2): background detection ─────────────────────
//
// Fire-and-forget, throttled (default 30 min). Only DETECTS a newer
// version and stages it in ~/.appx-core/state.json; the install happens
// on the NEXT invocation via the apply step above. Never blocks the
// current command. Skipped in the re-exec'd child, for `appx-core
// update`, and when disabled via env.
if (
    !process.env[autoUpdate.REEXEC_ENV_FLAG] &&
    process.env[autoUpdate.ENV_DISABLE] !== '1' &&
    subcommand !== 'update'
) {
    void autoUpdate.checkForUpdate({
        packageName: packageJson.name,
        currentVersion: packageJson.version,
    }).catch(() => {}); // best-effort; never surface a background failure
}

await program.parseAsync(process.argv);
