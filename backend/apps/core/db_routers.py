"""Read/write splitting for reporting queries (SRS §7 Scalability)."""


class ReplicaRouter:
    """
    Send dashboard and report reads to the replica; everything else to the primary.

    Only apps that tolerate replica lag are routed. Inventory and AI events must never
    read from the replica — a stale balance read would undermine the stock guarantee
    (ADR 0002).
    """

    REPLICA_APPS = {"dashboard"}

    def db_for_read(self, model, **hints):
        if model._meta.app_label in self.REPLICA_APPS:
            return "replica"
        return "default"

    def db_for_write(self, model, **hints):
        return "default"

    def allow_relation(self, obj1, obj2, **hints):
        return True

    def allow_migrate(self, db, app_label, model_name=None, **hints):
        return db == "default"
