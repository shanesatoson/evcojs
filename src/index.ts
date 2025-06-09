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

interface CommandHandler {
  handle: (command: any, state?: any) => CloudEvent<any>[];
  context: string;
  type: string;
}

interface StateRebuilder {
  stateRebuilder: (event: any, state?: any) => any;
  context: string;
  type: string;
}

interface EventHandler {
  eventHandler: (events: CloudEvent<any>, state?: any) => void;
  type: string;
}

interface UpCasthandler {
  upcast: (event: CloudEvent<any>) => CloudEvent<any>;
  type: string;
}

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

export function registerEventhandler(
  type: string,
  func: (event: CloudEvent<any>, state?: any) => void
) {
  if (!eventHandler.has(type)) {
    eventHandler.set(type, []);
  }
  eventHandler.get(type)!.push({ type, eventHandler: func });
}

export function registerStateLoadingFunction(
  context: string,
  load: (subjects: string[]) => Promise<CloudEvent<any>[]>
) {
  stateLoader.set(context, { load, context: context });
}

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

function maybeUpcast(event: CloudEvent<any>) {
  const upcaster = upcastHandler.get(event.type);
  if (upcaster) {
    return upcaster.upcast(event);
  }
  return event;
}

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

function executeEvent(context: string, event: CloudEvent<any>, state: null) {
  const rebuilder = stateRebuilder.get(createKey(context, event.type));
  if (rebuilder && rebuilder.context === context) {
    state = rebuilder.stateRebuilder(event.data, state);
  }
  return state;
}

function createKey(context: string, type: string): string {
  return `[${context}|${type}]`;
}

export function CommandHandler(
  target: any,
  propertyKey: string,
  descriptor: PropertyDescriptor
) {
  console.log(target, propertyKey, descriptor);
}
