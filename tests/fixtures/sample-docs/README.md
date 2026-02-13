# TaskFlow

A lightweight task management library for Node.js applications.

## Features

- Create, update, and delete tasks
- Priority-based scheduling
- Async task execution with configurable concurrency
- Built-in retry logic with exponential backoff
- TypeScript-first with full type safety

## Installation

```bash
npm install taskflow
```

## Quick Start

```typescript
import { TaskFlow } from 'taskflow';

const tf = new TaskFlow({ concurrency: 5 });
tf.add({ name: 'deploy', fn: async () => { /* ... */ } });
await tf.run();
```
