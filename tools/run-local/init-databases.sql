-- Runs once, the first time the PostgreSQL container starts with an empty volume.
-- One database per service, as configured in the config repo. Tables are created by
-- Hibernate (ddl-auto: update) when each service starts.
CREATE DATABASE "razorpay-merchant-db";
CREATE DATABASE "razorpay-payment-db";
CREATE DATABASE "razorpay-vault-db";
CREATE DATABASE "razorpay-operations-db";
