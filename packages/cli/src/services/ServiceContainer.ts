import { EventEmitter } from "events";

import { ROOT_REALM, realmTree, type RealmId } from "../realm/realmTree.js";
import { currentRealmId } from "../realm/scope.js";
import { serviceTable } from "../realm/serviceTable.js";
import { logger } from "../utils/logger.js";

import { type ServiceResult, type ServiceState } from "./types.js";

type ServiceListener = (...args: any[]) => void;

interface ScopedListenerRegistration {
  event: string | symbol;
  realm: RealmId;
  wrapper: ServiceListener;
}

/**
 * Central service container that manages service lifecycle and dependencies
 * Uses EventEmitter for reactive updates across the application
 */
export class ServiceContainer extends EventEmitter {
  private services = new Map<string, ServiceResult<any>>();
  private factories = new Map<string, () => Promise<any>>();
  private dependencies = new Map<string, string[]>();
  private scopedFactories = new Map<number, Map<string, () => Promise<any>>>();
  private scopedDependencies = new Map<number, Map<string, string[]>>();
  private scopedListeners = new Map<
    ServiceListener,
    ScopedListenerRegistration[]
  >();

  constructor() {
    super();
    // Increase max listeners to handle multiple UI components
    this.setMaxListeners(50);
  }

  override on(event: string | symbol, listener: ServiceListener): this {
    return this.addScopedListener(event, listener, false);
  }

  override addListener(
    event: string | symbol,
    listener: ServiceListener,
  ): this {
    return this.addScopedListener(event, listener, false);
  }

  override once(event: string | symbol, listener: ServiceListener): this {
    return this.addScopedListener(event, listener, true);
  }

  override off(event: string | symbol, listener: ServiceListener): this {
    const realm = currentRealmId();
    const registrations = this.scopedListeners.get(listener);
    const registration = registrations
      ?.slice()
      .reverse()
      .find((entry) => entry.event === event && entry.realm === realm);
    if (!registration) return this;
    super.off(event, registration.wrapper);
    registrations!.splice(registrations!.indexOf(registration), 1);
    if (registrations!.length === 0) {
      this.scopedListeners.delete(listener);
    }
    return this;
  }

  override removeListener(
    event: string | symbol,
    listener: ServiceListener,
  ): this {
    return this.off(event, listener);
  }

  private addScopedListener(
    event: string | symbol,
    listener: ServiceListener,
    once: boolean,
  ): this {
    const realm = currentRealmId();
    const registrations = this.scopedListeners.get(listener) ?? [];
    const wrapper: ServiceListener = (...args) => {
      if (!realmTree.visibleFrom(currentRealmId(), realm)) return;
      if (once) {
        super.off(event, wrapper);
        registrations.splice(
          registrations.findIndex((entry) => entry.wrapper === wrapper),
          1,
        );
        if (registrations.length === 0) {
          this.scopedListeners.delete(listener);
        }
      }
      listener(...args);
    };
    registrations.push({ event, realm, wrapper });
    this.scopedListeners.set(listener, registrations);
    super.on(event, wrapper);
    return this;
  }

  /**
   * Register a service factory with optional dependencies
   */
  register<T>(
    serviceName: string,
    factory: () => Promise<T>,
    deps: string[] = [],
  ): void {
    const realm = currentRealmId();
    if (realm === ROOT_REALM) {
      this.factories.set(serviceName, factory);
      this.dependencies.set(serviceName, deps);
      if (!this.services.has(serviceName)) {
        this.services.set(serviceName, {
          value: null,
          state: "idle",
          error: null,
        });
      }
    } else {
      let factories = this.scopedFactories.get(realm);
      if (!factories) {
        factories = new Map();
        this.scopedFactories.set(realm, factories);
      }
      let dependencies = this.scopedDependencies.get(realm);
      if (!dependencies) {
        dependencies = new Map();
        this.scopedDependencies.set(realm, dependencies);
      }
      factories.set(serviceName, factory);
      dependencies.set(serviceName, deps);
    }

    logger.debug(`Registered service: ${serviceName}`, { dependencies: deps });
  }

  /**
   * Register a service with an immediate value (no factory needed)
   * Used when the service is already initialized
   */
  registerValue<T>(serviceName: string, value: T): void {
    this.setServiceValue(serviceName, value);
    logger.debug(`Registered service with immediate value: ${serviceName}`, {
      state: "ready",
      hasValue: value !== null,
      serviceMapSize: this.services.size,
    });
  }

  /**
   * Whether a factory or value exists for this service, without logging the
   * "not found" warning `getSync` emits for a name nothing registered.
   */
  has(serviceName: string): boolean {
    const realm = currentRealmId();
    return Boolean(
      this.findResult(serviceName) ||
      this.scopedFactories.get(realm)?.has(serviceName) ||
      this.factories.has(serviceName),
    );
  }

  /**
   * Get current service result (synchronous)
   */
  getSync<T>(serviceName: string): ServiceResult<T> {
    const result = this.findResult(serviceName);
    if (result) return result as ServiceResult<T>;
    if (this.scopedFactories.get(currentRealmId())?.has(serviceName)) {
      return { value: null, state: "idle", error: null };
    }
    logger.warn(`Service not found: ${serviceName}`);
    return {
      value: null,
      state: "error",
      error: new Error(`Service '${serviceName}' not registered`),
    };
  }

  /**
   * Get service value, loading if necessary (async)
   */
  async get<T>(serviceName: string): Promise<T> {
    const current = this.getSync<T>(serviceName);

    if (current.state === "ready" && current.value !== null) {
      return current.value;
    }

    if (current.state === "loading") {
      const realm = currentRealmId();
      if (realm !== ROOT_REALM) {
        return new Promise<T>((resolve, reject) => {
          const cleanup = () =>
            serviceTable.off(`${serviceName}:provided`, onProvided);
          const onProvided = (payload: {
            realm: number;
            value: ServiceResult<T>;
          }) => {
            if (payload.realm !== realm) return;
            cleanup();
            if (
              payload.value.state === "ready" &&
              payload.value.value !== null
            ) {
              resolve(payload.value.value);
            } else {
              reject(
                payload.value.error ??
                  new Error(`Service '${serviceName}' failed to load`),
              );
            }
          };
          serviceTable.on(`${serviceName}:provided`, onProvided);
          const latest = serviceTable.get<ServiceResult<T>>(serviceName, realm);
          if (latest && latest.state !== "loading") {
            onProvided({ realm, value: latest });
          }
        });
      }
      return new Promise((resolve, reject) => {
        const onReady = (value: T) => {
          this.off(`${serviceName}:ready`, onReady);
          this.off(`${serviceName}:error`, onError);
          resolve(value);
        };

        const onError = (error: Error) => {
          this.off(`${serviceName}:ready`, onReady);
          this.off(`${serviceName}:error`, onError);
          reject(error);
        };

        this.once(`${serviceName}:ready`, onReady);
        this.once(`${serviceName}:error`, onError);
      });
    }

    // Need to load
    return this.load<T>(serviceName);
  }

  /**
   * Load a service, handling dependencies
   */
  async load<T>(serviceName: string): Promise<T> {
    const realm = currentRealmId();
    const factory =
      this.scopedFactories.get(realm)?.get(serviceName) ??
      this.factories.get(serviceName);
    if (!factory) {
      const error = new Error(
        `No factory registered for service '${serviceName}'`,
      );
      this.setServiceError(serviceName, error);
      throw error;
    }

    // Check if already loading
    const current = this.findResult(serviceName);
    if (current?.state === "loading") {
      return this.get<T>(serviceName);
    }

    logger.debug(`Loading service: ${serviceName}`);
    this.setServiceState(serviceName, "loading");

    try {
      // Load dependencies first
      const deps =
        this.scopedDependencies.get(realm)?.get(serviceName) ??
        this.dependencies.get(serviceName) ??
        [];
      await Promise.all(deps.map((dep) => this.load(dep)));

      // Load the service
      const value = await factory();

      this.setServiceValue(serviceName, value);
      logger.debug(`Service loaded successfully: ${serviceName}`);

      return value;
    } catch (error: any) {
      logger.debug(`Failed to load service '${serviceName}':`, error);
      this.setServiceError(serviceName, error);
      throw error;
    }
  }

  /**
   * Reload a service (and all transitive dependents)
   */
  async reload<T>(serviceName: string): Promise<T> {
    logger.debug(`Reloading service: ${serviceName}`);

    // Find all services that depend on this one (recursively)
    const dependents = this.findAllDependents(serviceName);

    logger.debug(`Found dependents for ${serviceName}:`, dependents);

    // Reset this service and all dependents to ensure fresh reload
    this.resetService(serviceName);
    dependents.forEach((dep) => this.resetService(dep));

    // Now reload ALL services that were reset, starting with the root service
    // This ensures proper dependency order and that all dependents get reloaded
    const allToReload = [serviceName, ...dependents];

    // Reset ALL services first to ensure clean state
    allToReload.forEach((name) => this.resetService(name));

    // Load all services in dependency order - starting with the root service
    // will naturally load its dependents when they're requested
    const results = await Promise.all(
      allToReload.map((name) => this.load(name)),
    );

    // Return the value of the primary service that was reloaded
    return results[0] as T;
  }

  /**
   * Find all services that transitively depend on the given service
   */
  private findAllDependents(serviceName: string): string[] {
    const result = new Set<string>();
    const visited = new Set<string>();

    const findDeps = (name: string) => {
      if (visited.has(name)) return;
      visited.add(name);

      // Find direct dependents
      const directDependents = Array.from(this.dependencies.entries())
        .concat(
          Array.from(
            this.scopedDependencies.get(currentRealmId())?.entries() ?? [],
          ),
        )
        .filter(([_, deps]) => deps.includes(name))
        .map(([depName, _]) => depName);

      for (const dependent of directDependents) {
        result.add(dependent);
        findDeps(dependent); // Recurse for transitive dependencies
      }
    };

    findDeps(serviceName);
    return Array.from(result);
  }

  /**
   * Manually set a service value (for testing or external updates)
   */
  set<T>(serviceName: string, value: T): void {
    this.setServiceValue(serviceName, value);
  }

  /**
   * Check if service is ready
   */
  isReady(serviceName: string): boolean {
    const result = this.findResult(serviceName);
    return result?.state === "ready" && result.value !== null;
  }

  /**
   * Check if service is loading
   */
  isLoading(serviceName: string): boolean {
    const result = this.findResult(serviceName);
    return result?.state === "loading";
  }

  /**
   * Initialize all registered services
   * This eagerly loads all services rather than waiting for them to be requested
   */
  async initializeAll(): Promise<void> {
    logger.debug("Initializing all registered services");

    // Get all registered service names
    const serviceNames = [
      ...new Set([
        ...this.factories.keys(),
        ...(this.scopedFactories.get(currentRealmId())?.keys() ?? []),
      ]),
    ];

    // Load all services in parallel (dependencies will be handled by load())
    await Promise.all(
      serviceNames.map((name) =>
        this.load(name).catch((error) => {
          logger.debug(`Failed to initialize service ${name}:`, error);
          // Don't throw - let individual services fail without breaking others
        }),
      ),
    );

    logger.debug(
      "All services initialization complete",
      this.getServiceStates(),
    );
  }

  /**
   * Get all service states (for debugging)
   */
  getServiceStates(): Record<string, ServiceState> {
    const states: Record<string, ServiceState> = {};
    for (const [name, result] of this.services) {
      states[name] = result.state;
    }
    return states;
  }

  /**
   * Private helper methods
   */
  private findResult(serviceName: string): ServiceResult<unknown> | undefined {
    return (
      serviceTable.get<ServiceResult<unknown>>(serviceName, currentRealmId()) ??
      this.services.get(serviceName)
    );
  }

  private writeResult(
    serviceName: string,
    result: ServiceResult<unknown>,
  ): void {
    const realm = currentRealmId();
    if (realm === ROOT_REALM) {
      this.services.set(serviceName, result);
    } else {
      serviceTable.set(serviceName, realm, result, "ServiceContainer");
    }
  }

  private setServiceState(serviceName: string, state: ServiceState): void {
    const current = this.findResult(serviceName) || {
      value: null,
      state: "idle",
      error: null,
    };
    const updated = { ...current, state, lastUpdated: new Date() };
    this.writeResult(serviceName, updated);
    this.emit(`${serviceName}:${state}`);
  }

  private setServiceValue<T>(serviceName: string, value: T): void {
    const result: ServiceResult<T> = {
      value,
      state: "ready",
      error: null,
      lastUpdated: new Date(),
    };

    this.writeResult(serviceName, result);
    this.emit(`${serviceName}:ready`, value);
    this.emit(`${serviceName}:changed`, value);
  }

  private setServiceError(serviceName: string, error: Error): void {
    const result: ServiceResult<any> = {
      value: null,
      state: "error",
      error,
      lastUpdated: new Date(),
    };

    this.writeResult(serviceName, result);
    this.emit(`${serviceName}:error`, error);
  }

  private resetService(serviceName: string): void {
    const result: ServiceResult<any> = {
      value: null,
      state: "idle",
      error: null,
    };

    this.writeResult(serviceName, result);
  }
}

// Global singleton instance
export const serviceContainer = new ServiceContainer();
