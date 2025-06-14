import { randomUUID } from "node:crypto";

/**
 * Represents a command in a CQRS architecture.
 *
 * @template C - The type of data associated with the command.
 * @type the unique command type
 * @subjects the subjects to fetch state from
 */
export interface Command<C> {
  type: string;
  subjects: string[];
  data: C;
}

/**
 * Represents a standard CloudEvent.
 */
export interface CloudEvent<T> {
  source?: string;
  subject: string;
  type: string;
  id?: string;
  timestamp?: Date;
  data: T;
}

/**
 * Represents a command handler in a CQRS architecture.
 *
 * @template C - The type of data associated with the command.
 * @type the unique command type
 * @subjects the subjects to fetch state from
 */
interface CommandHandler {
  handle: (command: any, state?: any) => CloudEvent<any>[];
  context: string;
  type: string;
}

/**
 * Represents a state rebuilder in a CQRS architecture.
 */
interface StateRebuilder {
  stateRebuilder: (event: any, state?: any) => any;
  context: string;
  type: string;
}

/**
 * Represents an event handler in a CQRS architecture.
 */
interface EventHandler {
  eventHandler: (events: CloudEvent<any>, state?: any) => void;
  type: string;
}

/**
 * Represents an upcaster in a CQRS architecture.
 */
interface UpCasthandler {
  upcast: (event: CloudEvent<any>) => CloudEvent<any>;
  type: string;
}

/**
 * Represents a state loader function in a CQRS architecture.
 */
interface StateLoaderFunction {
  load: (subjects: string[]) => Promise<CloudEvent<any>[]>;
  context: string;
}
let source = "CQRS_DEFAULTSOURCE";
const commands: Map<string, CommandHandler> = new Map();
const stateRebuilder: Map<string, StateRebuilder> = new Map();
const eventHandler: Map<string, EventHandler[]> = new Map();
const upcastHandler: Map<string, UpCasthandler> = new Map();
const stateLoader: Map<string, StateLoaderFunction> = new Map();

/**
 * Sets the default source for all commands and events.
 *
 * @param {string} src
 */
export function setSource(src: string) {
  source = src;
}
/**
 * Registers a upcaster function for a given event type.
 *
 * The upcaster function will be called before the event is processed.
 * The upcaster function takes an event and returns a new event.
 * The new event will be used instead of the original event.
 *
 * @param {string} type - The type of the event.
 * @param {function(CloudEvent<any>): CloudEvent<any>} func - The upcaster function.
 */
export function registerUpcaster(
  type: string,
  func: (event: CloudEvent<any>) => CloudEvent<any>
) {
  upcastHandler.set(type, { type, upcast: func });
}

/**
 * Registers an event handler for a specific event type.
 *
 * @param {string} type - The type of the event to register the handler for.
 * @param {function(CloudEvent<any>, any): void} func - The event handler function
 * that processes the event and optionally the current state.
 *
 * The event handler is added to a list of handlers associated with the event type.
 * If no handlers exist for the given type, a new list is created.
 */

export function registerEventhandler(
  type: string,
  func: (event: CloudEvent<any>, state?: any) => void
) {
  if (!eventHandler.has(type)) {
    eventHandler.set(type, []);
  }
  eventHandler.get(type)!.push({ type, eventHandler: func });
}

/**
 * Registers a function that loads historical events for a specific context.
 *
 * The function is called with an array of subjects (e.g., '/book/123') and
 * should return a Promise that resolves with an array of historical events
 * associated with the given subjects.
 *
 * @param context - The context for which the events are loaded.
 * @param load - The function that loads the events.
 */
export function registerStateLoadingFunction(
  context: string,
  load: (subjects: string[]) => Promise<CloudEvent<any>[]>
) {
  stateLoader.set(context, { load, context: context });
}

/**
 * Registers a command handler for a specific command type.
 *
 * The command handler is a function that validates business rules and
 * returns new events to be saved persistently.
 *
 * @param {string} type - The type of the command to register the handler for.
 * @param {string} context - The context in which the command is executed.
 * @param {function(any, any): CloudEvent<any>[]} commandHandler - The command handler function.
 * The function receives the command and the current state and returns an array of new events.
 */
export function registerCommandHandler(
  type: string,
  context: string,
  commandHandler: (command: any, state?: any) => CloudEvent<any>[]
) {
  if (commands.has(type)) {
    throw new Error(`Command handler for ${type} already exists`);
  }
  commands.set(type, { type, context, handle: commandHandler });
}

/**
 * Registers a state rebuilder function for a specific event type within a given context.
 *
 * The state rebuilder function is responsible for applying the event to the current state
 * to produce an updated state. It is an essential part of the event sourcing pattern,
 * allowing the system to reconstruct the state by replaying events.
 *
 * @param {string} type - The type of the event for which the state rebuilder is registered.
 * @param {string} context - The context in which the state rebuilder operates.
 * @param {function(any): void} builderHandler - The state rebuilder function that applies
 * the event to the state.
 *
 * @throws Will throw an error if a state rebuilder for the given event type and context
 * already exists.
 */

export function registerStateRebuilder(
  type: string,
  context: string,
  builderHandler: (event: any) => void
) {
  const key = createKey(context, type);
  if (stateRebuilder.has(key)) {
    throw new Error(`State rebuilder for ${key} already exists`);
  }
  stateRebuilder.set(key, {
    type,
    context,
    stateRebuilder: builderHandler,
  });
}

/**
 * Applies an upcaster function to the given event if a matching upcaster is
 * registered. If no upcaster is registered, the event is passed through unchanged.
 *
 * @param {CloudEvent<any>} event - The event to upcast or pass through.
 * @returns {CloudEvent<any>} The upcasted event if an upcaster is registered,
 * otherwise the original event.
 */
function maybeUpcast(event: CloudEvent<any>) {
  const upcaster = upcastHandler.get(event.type);
  if (upcaster) {
    return upcaster.upcast(event);
  }
  return event;
}

/**
 * Executes a command and applies the returned events to the state.
 *
 * @param {Command<C>} command - The command to execute.
 *
 * @returns {Promise<void>} A promise that resolves when the command has been
 * executed and the state has been updated.
 */
export async function handleCommand<C>(command: Command<C>) {
  const commandHandler = commands.get(command.type);
  if (commandHandler) {
    let state = await createState<C>(commandHandler.context, command.subjects);
    const newEvents = commandHandler.handle(command.data, state);
    for (const event of newEvents) {
      state = executeEvent(commandHandler.context, event, state);
    }
    const cloudEvents: CloudEvent<any>[] = newEvents.map((event) => {
      return {
        source: event.source ?? source,
        subject: event.subject,
        type: event.type,
        id: event.id ?? randomUUID(),
        timestamp: event.timestamp ?? new Date(),
        data: event.data,
      };
    });
    for (const cloudEvent of cloudEvents) {
      if (eventHandler.has(cloudEvent.type)) {
        eventHandler
          .get(cloudEvent.type)!
          .forEach((eh) => eh.eventHandler(cloudEvent, state));
      }
    }
  }
}
/**
 * Reconstructs the state for a given context and subjects by loading and processing historical events.
 *
 * @template C - The type of the state to be reconstructed.
 *
 * @param {string} context - The unique context for which the state is reconstructed.
 * @param {string[]} subjects - An array of subjects used to load relevant events.
 *
 * @returns {Promise<any>} A promise that resolves to the reconstructed state.
 *
 * The function retrieves the state loading function associated with the provided context,
 * loads historical events for the specified subjects, and applies each event to rebuild
 * the current state. If no state loading function is found, an empty state is returned.
 */

export async function createState<C>(context: string, subjects: string[]) {
  const stateLoadingFunction = stateLoader.get(context);
  let events = stateLoadingFunction
    ? await stateLoadingFunction.load(subjects)
    : [];

  events = events.map(maybeUpcast);
  let state = null;
  for (const event of events) {
    state = executeEvent(context, event, state);
  }
  return state;
}

/**
 * Applies an event to the state by executing the associated state rebuilder.
 *
 * @param {string} context - The context of the event.
 * @param {CloudEvent<any>} event - The event to be applied to the state.
 * @param {any} [state=null] - The current state.
 *
 * @returns {any} The updated state.
 *
 * If no state rebuilder is registered for the given event type and context, the
 * event is ignored and the state is returned unchanged.
 */
function executeEvent(context: string, event: CloudEvent<any>, state: null) {
  const rebuilder = stateRebuilder.get(createKey(context, event.type));
  if (rebuilder && rebuilder.context === context) {
    state = rebuilder.stateRebuilder(event.data, state);
  }
  return state;
}

/**
 * Creates a unique key for the given context and event type.
 *
 * @param {string} context - The context of the event.
 * @param {string} type - The type of the event.
 *
 * @returns {string} The unique key.
 */
function createKey(context: string, type: string): string {
  return `[${context}|${type}]`;
}
