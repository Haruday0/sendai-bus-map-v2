# syntax=docker/dockerfile:1
FROM golang:1.25-alpine AS builder

WORKDIR /app

# Install CA certs for HTTPS
RUN apk add --no-cache ca-certificates

COPY go.mod go.sum ./
RUN go mod download

COPY . ./

# Build a static binary for smaller runtime image
ENV CGO_ENABLED=0
RUN go build -o server .

FROM gcr.io/distroless/base-debian12

WORKDIR /app

COPY --from=builder /app/server /app/server
COPY --from=builder /app/data /app/data

# Cloud Run sets PORT at runtime
EXPOSE 8080

USER nonroot:nonroot

ENTRYPOINT ["/app/server"]
