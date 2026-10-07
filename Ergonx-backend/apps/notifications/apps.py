from django.apps import AppConfig


class NotificationsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.notifications"
    label = "notifications"

    def ready(self):
        from django.db.models.signals import post_save

        from apps.notifications.models import Notification
        from apps.notifications.services import queue_notification_email

        def email_copy(sender, instance, created, raw=False, **kwargs):
            if created and not raw:
                queue_notification_email(instance)

        post_save.connect(email_copy, sender=Notification, dispatch_uid="notifications.email_copy", weak=False)
