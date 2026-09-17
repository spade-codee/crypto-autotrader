import { createInterface } from 'node:readline';

export function requireInteractiveTerminal(): void {
  if (!process.stdin.isTTY) {
    throw new Error(
      'This command reads secrets and must run in an interactive terminal such as PowerShell or Windows Terminal, not through a pipe.',
    );
  }
}

/** Reads one line, echoed as typed. */
export function ask(question: string): Promise<string> {
  requireInteractiveTerminal();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Reads one line without echoing it, using raw mode rather than readline
 * internals. Handles Enter, Backspace, and Ctrl+C, and strips bracketed-paste
 * markers some terminals wrap around pasted text.
 */
export function askHidden(question: string): Promise<string> {
  requireInteractiveTerminal();
  const stdin = process.stdin;
  process.stdout.write(question);
  stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.resume();

  return new Promise((resolve, reject) => {
    let value = '';

    const cleanUp = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
    };

    function onData(chunk: string) {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          cleanUp();
          resolve(value.replace(/\[20[01]~/g, '').trim());
          return;
        }
        if (char === '') {
          cleanUp();
          reject(new Error('Cancelled.'));
          return;
        }
        if (char === '' || char === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    }

    stdin.on('data', onData);
  });
}
