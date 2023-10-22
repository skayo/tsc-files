#!/usr/bin/env node

import childProcess from 'node:child_process';
import fs from 'node:fs';
import module from 'node:module';
import path from 'node:path';
import process from 'node:process';

// This code is forked from the `tsc-files` package and modified, so it's an
// ESM module and works with `.js` files and PNPM.

// Create a require function that works with ESM
const require = module.createRequire(import.meta.url);

/**
 * Generate a random string of characters.
 * @returns {string}
 */
const randomChars = () => Math.random().toString(36).slice(2);

/**
 * Resolve a path from a module.
 * @param {string} moduleName
 * @param {...string} paths
 * @returns {string}
 */
const resolveFromModule = (moduleName, ...paths) => {
	const modulePath = path.dirname(require.resolve(`${moduleName}/package.json`));
	return path.join(modulePath, ...paths);
};

/**
 * Resolve a path from the root of the project.
 * @param {...string} paths
 * @returns {string}
 */
const resolveFromRoot = (...paths) => path.join(process.cwd(), ...paths);

// Get arguments without the node executable and this script
const args = process.argv.slice(2);

// Get the project argument and its value
const argsProjectIndex = args.findIndex(arg =>
	[ '-p', '--project' ].includes(arg),
);
const argsProjectValue = argsProjectIndex === -1
	? undefined
	: args[argsProjectIndex + 1];

// Get the files to type-check and check if we should show the help message
const files = args.filter(file => /\.(c|m)?(j|t)sx?$/.test(file));
if (args.includes('-h') || args.includes('--help') || files.length === 0) {
	console.log(`
Usage: tsc-files [files...] [options]

Options:
  -p, --project [project]     Path to the tsconfig.json file
  -h, --help                  Show this help message

  See \`tsc --help\` for more options.

Examples:
  $ tsc-files -p tsconfig.lint.json index.ts

  $ tsc-files --noEmit --allowJs index.js
`);
	process.exit(0);
}

// Get the arguments to forward to tsc
const remainingArgsToForward = args.filter(arg => !files.includes(arg));
if (argsProjectIndex !== -1) {
	remainingArgsToForward.splice(argsProjectIndex, 2);
}

// Load existing config
const tsconfigPath = argsProjectValue || resolveFromRoot('tsconfig.json');
const tsconfigContent = fs.readFileSync(tsconfigPath).toString();

// Evaluate the content as JS to support comments in the config file
const tsconfig = new Function(`return ${tsconfigContent}`)();

// Get a temporary tsconfig file path
let temporaryTsconfigPath = resolveFromRoot(
	`tsconfig.tsc-files-${randomChars()}.json`,
);
while (fs.existsSync(temporaryTsconfigPath)) {
	temporaryTsconfigPath = resolveFromRoot(
		`tsconfig.tsc-files-${randomChars()}.json`,
	);
}

// Create a new temporary config file with the files to type-check
fs.writeFileSync(
	temporaryTsconfigPath,
	JSON.stringify({
		...tsconfig,
		compilerOptions: {
			...tsconfig.compilerOptions,
			skipLibCheck: true,
		},
		files,
		include: [],
	}, undefined, 2),
);

// Attach cleanup handlers to remove the temporary config file on exit
let didCleanup = false;
for (const eventName of [ 'exit', 'SIGHUP', 'SIGINT', 'SIGTERM' ]) {
	process.on(eventName, exitCode => {
		if (didCleanup) {
			return;
		}

		didCleanup = true;
		fs.unlinkSync(temporaryTsconfigPath);

		if (eventName !== 'exit') {
			process.exit(exitCode);
		}
	});
}

// Resolve tsc executable
let tsc = '';
if (process.versions.pnp) {
	tsc = 'tsc';
} else {
	tsc = resolveFromModule(
		'typescript',
		`../.bin/tsc${process.platform === 'win32' ? '.cmd' : ''}`,
	);

	if (!fs.existsSync(tsc)) {
		tsc = resolveFromModule(
			'typescript',
			`./bin/tsc${process.platform === 'win32' ? '.cmd' : ''}`,
		);
	}

	if (!fs.existsSync(tsc)) {
		console.error('Failed to resolve tsc executable.');
		process.exit(1);
	}
}

// Type-check our files
const result = childProcess.spawnSync(
	tsc,
	[ '-p', temporaryTsconfigPath, ...remainingArgsToForward ],
	{ stdio: 'inherit', shell: process.platform === 'win32' },
);

// Check if tsc failed to spawn
if (result.status === null) {
	console.error('Failed to spawn tsc.');
	// DEBUG: console.debug(result);
	process.exit(1);
}

// Exit with the same status code as tsc
process.exit(result.status);
