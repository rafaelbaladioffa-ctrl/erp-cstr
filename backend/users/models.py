from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    email = models.EmailField("e-mail", unique=True)
    company = models.ForeignKey(
        "core.Company",
        verbose_name="empresa",
        on_delete=models.PROTECT,
        related_name="users",
        null=True,
        blank=True,
    )

    class Meta:
        verbose_name = "usuário"
        verbose_name_plural = "usuários"
