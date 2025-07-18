import { spawn } from 'child_process';
import svelte from 'rollup-plugin-svelte';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import resolve from '@rollup/plugin-node-resolve';
import livereload from 'rollup-plugin-livereload';
import css from 'rollup-plugin-css-only';
import html from '@rollup/plugin-html';
import copy from 'rollup-plugin-copy'; // Copy plugin added
import json from '@rollup/plugin-json';


const production = !process.env.ROLLUP_WATCH;

function serve() {
    let server;
    function toExit() {
        if (server) server.kill(0);
    }
    return {
        writeBundle() {
            if (server) return;
            server = spawn('npm', ['run', 'start', '--', '--dev'], {
                stdio: ['ignore', 'inherit', 'inherit'],
                shell: true
            });
            process.on('SIGTERM', toExit);
            process.on('exit', toExit);
        }
    };
}

export default {
    input: 'src/main.js',
    output: {
        dir: '../backend/grpproj/grpproj/static',
        sourcemap: true,
        format: 'iife',
        name: 'app',
    },
    plugins: [
        json(),
        svelte({ compilerOptions: { dev: !production } }),
        css({ output: 'bundle.css' }),
        resolve({ browser: true, dedupe: ['svelte'], exportConditions: ['svelte'] }),
        commonjs(),
        html({ inject: { inject: '<script src="bundle.js"></script>', css: '<link rel="stylesheet" href="bundle.css">' } }),
        copy({  
            targets: [
                { src: 'public/*', dest: '../backend/grpproj/grpproj/static' } // Copies contents, not the folder itself
            ]
        }),
        !production && serve(),
        !production && livereload('public'),
        production && terser()
    ],
    watch: { clearScreen: false }
};
