# evcojs

The name evcojs is a combination of the words "event", "command" and "javascript". It is a library that helps to create applications with a clear separation of concerns between handling commands and handling events. This makes it easier to understand and maintain the bussiness logic based on requirements.

`evcojs` is a lightweight, dependency-free library for implementing CQRS (Command Query Responsibility Segregation) and Event Sourcing patterns in TypeScript and JavaScript. It helps to cleanly encapsulate business logic, improve scalability, and maintain a complete audit trail of all state changes.

evcojs is a library that automates the orchestration of event handlers, command handlers, and state rebuilders using the CloudEvents standard. It leverages a CQRS (Command Query Responsibility Segregation) pattern to segregate the read and write operations, allowing for a more scalable and maintainable architecture.

The library automatically registers command handlers, event handlers, and state rebuilders. Command handlers process incoming commands and generate events. These events are then handled by event handlers, which can trigger side effects or further processing. The state rebuilder plays a crucial role in this architecture: it rebuilds the application state based on the sequence of events, ensuring that the state is consistent and accurate.

By using CloudEvents as the standard for event data exchange, evcojs ensures interoperability and a uniform event model across distributed systems. The state rebuilder utilizes these CloudEvents to reconstruct the application state, allowing the system to maintain a reliable and up-to-date representation of its current status.

This approach facilitates a clean separation of concerns, improves scalability, and enhances the ability to evolve the system architecture over time.

# CloudEvents

evcojs is compatible with the offictial CNCF https://cloudevents.io/ standard.

## 1\. Installation

To use the library in your project, install it via npm:

```bash
npm i evcojs
```

## 2\. Core Concepts

To use `evcojs` effectively, it's important to understand the following patterns:

- **CQRS (Command Query Responsibility Segregation):** This pattern separates operations that write data (Commands) from operations that read data (Queries). `evcojs` implements this by using `handleCommand` for write operations and `createState` for read operations.
- **Event Sourcing:** Instead of storing the current state of an entity, you store the entire sequence of events that led to that state. The state is reconstructed on demand by replaying these events. This provides a robust audit trail and enables powerful analytical capabilities.
- **Command:** A command is an intent to change the state of the system (e.g., `CatalogBookCommand`). Command handlers validate the command and, if successful, generate one or more events.
- **Event:** An event is an immutable fact that happened in the past (e.g., `BookCatalogedEvent`). Events are used to change the state and to trigger actions in response to state changes (e.g., saving to a database). `evcojs` uses the [CNCF CloudEvents](https://cloudevents.io/) format for a standardized structure.
- **State:** The state is the result of applying all past events to an initial state. It is calculated at runtime to validate business rules in command handlers.
- **Projection:** A projection is a read-optimized representation of the data. It is created by subscribing to events and is stored in a separate database or table to enable fast queries.

## 3\. Architecture and Structure

An `evcojs` application does not enforce a specific structure, but you should ensures that domain modules are encapsulated and domain handlers do not directly use infrastructure code, such as database read/write operations.
A typical `evcojs` application is organized into domain modules that cleanly separate business logic.

```

├── domain-modules/
│   ├── book-catalog/
│   │   ├── book-catalog.domain.ts      # Business Logic: Command Handlers, State Rebuilders
│   │   ├── book-catalog.model.ts       # Data Types: Commands, Events, State, Context
│   │   └── book-catalog.repository.ts  # Persistence: Event Handlers, State Loader
│   └── book-inventory/
│       ├── book-inventory.domain.ts
│       ├── book-inventory.model.ts
│       └── book-inventory.repository.ts
├── database/
│   └── database-connection.ts          # connect to DB
└── controller/
    └── ...                             # HTTP controller
```

- **`domain-modules`**: This folder contains the encapsulated business logic. Each subdirectory represents a domain (e.g., `book-catalog`).
  - **`.model.ts`**: Defines all TypeScript interfaces for the domain: Commands, Events, and the `State` structure. The domain's unique `CONTEXT` is also defined here.
  - **`.domain.ts`**: Implements the "Write Side" of CQRS. This is where the **Command Handlers** (which execute business rules) and the **State Rebuilders** (which reconstruct the state from events) reside. **Should never contains an import from infrastructure stuff, eg. database calls etc.**
  - **`.repository.ts`**: Implements the persistence logic. This is where the **Event Handlers** (which save events to a database or update projections) and the **State Loaders** (which load events from the database) reside.
- **`database`**: Contains the data layer. In the examples, this is a simple in-memory database. In a real application, you would establish connections to your SQL, NoSQL, or event sourcing database here.
- **`controller`**: Shows how the domain modules are used by a higher-level layer (e.g., an Express.js server).

## 4\. Key Components of evcojs

### The `context`

The `context` is a unique string (e.g., `"domain:book-catalog"`) that acts as a namespace for a domain. It is crucial because it's used when registering handlers. When a command is executed, the `context` ensures that the associated `stateLoader`, `stateRebuilders`, and `eventHandlers` are correctly identified and executed.

### The Lifecycle of a Command with `handleCommand`

Calling `handleCommand(command)` triggers the following chain of operations:

1.  **Receive Command:** `handleCommand` is called with a command object containing `type`, `subjects`, and `data`.
2.  **Find State Loader:** The library finds the `stateLoading` function registered for the command's `context`.
3.  **Load Events:** The `stateLoading` function is called with the command's `subjects` (e.g., `['/book/123']`). It loads all relevant historical events from the database.
4.  **Reconstruct State:** The library executes the `stateRebuilder` functions registered for this `context`. They are applied in the correct order to the loaded events to create the current `state`.
5.  **Execute Command:** The corresponding `commandHandler` is called, receiving the command and the reconstructed state. The handler validates business rules and returns one or more new events upon success.
6.  **Process New Events:**
    - The new events are immediately passed through the `stateRebuilders` to update the state.
    - The `eventHandlers` are called for each new event to save it persistently and update any projections.

### Querying State with `createState`

Calling `createState(context, subjects)` is the "Query" part of CQRS. It performs a subset of the above process without executing a command:

1.  Find the `stateLoader` for the given `context`.
2.  Load events for the `subjects`.
3.  Reconstruct the state using the `stateRebuilders`.
4.  Return the final state.

## 5\. Step-by-Step Guide: Creating a Domain

Here is a guide on how to create a new domain like `book-inventory`. The full working example is https://github.com/shanesatoson/evcojs-examples

### Step 1: Define the Model (`book-inventory.model.ts`)

Define all necessary data types and the context.

```typescript
// Unique context for this domain
export const INVENTORY_CONTEXT = "domain:book-inventory";

// Command interfaces
export interface RegisterCopyCommand {
  isbn: string;
}
export interface BorrowBookCommand {
  isbn: string;
}

// Event interfaces
export interface BookCopyRegisteredEvent {
  isbn: string;
}
export interface BookBorrowedEvent {
  isbn: string;
}

// The state interface of the domain
export interface State {
  isbn: string;
  amount: number; // Available copies
  maxCopies: number; // Total registered copies
}
```

### Step 2: Implement Domain Logic (`book-inventory.domain.ts`)

Implement the command handlers and state rebuilders. The registration functions tie them to the library's dispatcher.

```typescript
import {
  CloudEvent,
  registerCommandHandler,
  registerStateRebuilder,
} from "evcojs";
import {
  INVENTORY_CONTEXT,
  BorrowBookCommand,
  BookBorrowedEvent,
  State,
} from "./book-inventory.model";

// Command Handler: Executes business logic
function borrowBook(
  command: BorrowBookCommand,
  state?: State
): CloudEvent<BookBorrowedEvent>[] {
  if (!state || state.amount <= 0) {
    throw new Error("No copy available anymore");
  }
  return [
    {
      type: "event.book.copy.borrowed",
      subject: "/book/" + command.isbn,
      data: { isbn: command.isbn },
    },
  ];
}

// State Rebuilder: Applies an event to the state
function onBookBorrowed(event: BookBorrowedEvent, state?: State): State {
  return { ...state!, amount: state!.amount - 1 };
}

// Register these handlers with evcojs.
// This function should be called at your application's startup.
export function registerInventoryDomain() {
  registerCommandHandler(
    "command.book-inventory.borrow.copy",
    INVENTORY_CONTEXT,
    borrowBook
  );
  registerStateRebuilder(
    "event.book.copy.borrowed",
    INVENTORY_CONTEXT,
    onBookBorrowed
  );
  // ... register other handlers
}
```

**CloudEvents**

CloudEvents are based on the standard from: https://cloudevents.io/.

The fields "subject", "type" and "data" are mandatory, and "source", "id" and "timestamp" are optional and will be filled automatically.

**"source"** can be defined globally by:

```typescript
setSource("https://library.evcojs.org");
```

if not defined, all events gets a default source.

Events and the corresponding logic changes over time and old events must be proccessed by new logic. Therefor it is possible to upcast old events and keep only the new staterebuilder logic:

```typescript
function upcastCatalogedBook(
  event: CloudEvent<BookCatalogedEvent>
): CloudEvent<BookCatalogedV2Event> {
  return {
    type: "event.book.cataloged.v2",
    subject: event.subject,
    data: {
      isbn: event.data.isbn,
    },
  };
}

registerUpcaster(
  "event.book.cataloged",
  INVENTORY_CONTEXT,
  upcastCatalogedBook
);
```

### Step 3: Implement Persistence (`book-inventory.repository.ts`)

Implement how events are loaded and saved.

```typescript
import {
  CloudEvent,
  registerEventhandler,
  registerStateLoadingFunction,
} from "evcojs";
import { eventStore, projectionTable } from "../../database/in-memory-database";
import {
  INVENTORY_CONTEXT,
  State,
  BookBorrowedEvent,
} from "./book-inventory.model";

// Event Handler: Saves the event and updates a projection
function onBookBorrowedHandler(
  event: CloudEvent<BookBorrowedEvent>,
  state?: State
) {
  eventStore.push({ ...event }); // Save to event store
  // Update a projection (optional)
  const projection = projectionTable.get(event.data.isbn);
  if (projection) {
    projection.amount = state!.amount;
    projectionTable.set(event.data.isbn, projection);
  }
}

// State Loader: Loads events from the database
function stateLoading(subjects: string[]): Promise<CloudEvent<any>[]> {
  const events = eventStore.filter((event) => subjects.includes(event.subject));
  return Promise.resolve(events);
}

// Register these persistence handlers.
// This function should also be called at your application's startup.
export function registerInventoryPersistence() {
  registerEventhandler("event.book.copy.borrowed", onBookBorrowedHandler);
  registerStateLoadingFunction(INVENTORY_CONTEXT, stateLoading);
}
```

### Step 4: Use the Domain

Now you can send commands and query the state. Ensure the registration functions from the previous steps have been called once at application startup.

```typescript
import { handleCommand, createState } from "evcojs";
import { INVENTORY_CONTEXT } from "../domain-modules/book-inventory/book-inventory.model";

// Execute a command
async function borrowBookController(isbn: string) {
  try {
    const state = await handleCommand({
      type: "command.book-inventory.borrow.copy",
      subjects: ["/book/" + isbn], // Load events for this subject
      data: { isbn: isbn },
    });
    console.log("Book borrowed successfully!");
    console.log("here you can do anything with the current state", state);
  } catch (e) {
    console.error(e);
  }
}

// Query the state of an object
async function getInventoryState(isbn: string) {
  const inventoryState = await createState(INVENTORY_CONTEXT, [
    "/book/" + isbn,
  ]);
  console.log(inventoryState);
  return inventoryState;
}
```

## 6\. API Reference

### Registration Functions

- `registerCommandHandler(type: string, context: string, handler: Function)`: Registers a handler for a specific command type within the given context.
- `registerStateRebuilder(type: string, context: string, rebuilder: Function)`: Registers a function that updates the state based on an event type within the given context.
- `registerEventhandler(type: string, handler: Function)`: Registers a handler that is executed in response to an event type (e.g., for saving). This handler is context-agnostic.
- `registerStateLoadingFunction(context: string, loader: Function)`: Registers the function that loads historical events for a specific context.

### Execution Functions

- `handleCommand(command: CloudEvent): Promise<void>`: Executes the full cycle for processing a command.
- `createState(context: string, subjects: string[]): Promise<State>`: Loads events for the given subjects, reconstructs the state in the given context, and returns it.
