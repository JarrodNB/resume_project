variable "name" { type = string }
variable "instance_type" { type = string }
variable "postgres_volume_gb" { type = number }
variable "uploads_bucket_arn" { type = string }
variable "backups_bucket_arn" { type = string }
variable "queue_arns" { type = list(string) }
variable "repository_arns" { type = list(string) }

# The default VPC is free. A custom VPC would add nothing here without a NAT gateway.
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

data "aws_subnet" "first" {
  id = sort(data.aws_subnets.default.ids)[0]
}

data "aws_ssm_parameter" "ubuntu_ami" {
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
}

# Network
# Only web traffic is open. Shell access goes through SSM Session Manager, not SSH.
resource "aws_security_group" "web" {
  name        = "${var.name}-web"
  description = "HTTP and HTTPS from anywhere"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    from_port        = 80
    to_port          = 80
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  ingress {
    from_port        = 443
    to_port          = 443
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# Permissions
# The instance role replaces long-lived AWS keys on the server.
resource "aws_iam_role" "server" {
  name = "${var.name}-server"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.server.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "app" {
  name = "app-access"
  role = aws_iam_role.server.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Uploads"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
        Resource = [var.uploads_bucket_arn, "${var.uploads_bucket_arn}/*"]
      },
      {
        Sid      = "Backups"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject", "s3:ListBucket"]
        Resource = [var.backups_bucket_arn, "${var.backups_bucket_arn}/*"]
      },
      {
        Sid      = "Queues"
        Effect   = "Allow"
        Action   = ["sqs:SendMessage", "sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:GetQueueUrl", "sqs:ChangeMessageVisibility"]
        Resource = var.queue_arns
      },
      {
        Sid      = "PullImages"
        Effect   = "Allow"
        Action   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"]
        Resource = var.repository_arns
      },
      {
        Sid      = "EcrLogin"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
    ]
  })
}

resource "aws_iam_instance_profile" "server" {
  name = "${var.name}-server"
  role = aws_iam_role.server.name
}

# Server
resource "aws_instance" "this" {
  ami                    = nonsensitive(data.aws_ssm_parameter.ubuntu_ami.value)
  instance_type          = var.instance_type
  subnet_id              = data.aws_subnet.first.id
  vpc_security_group_ids = [aws_security_group.web.id]
  iam_instance_profile   = aws_iam_instance_profile.server.name

  # IMDSv2 only, so a request-forgery bug in an app cannot read the instance credentials.
  metadata_options {
    http_tokens = "required"
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = 20
    encrypted   = true
  }

  user_data = file("${path.module}/user_data.sh")

  # Editing user_data later would replace the server; apply changes by hand instead.
  lifecycle {
    ignore_changes = [ami, user_data]
  }

  tags = { Name = var.name }
}

# Postgres data lives on its own volume so replacing the server does not touch the data.
resource "aws_ebs_volume" "postgres" {
  availability_zone = data.aws_subnet.first.availability_zone
  size              = var.postgres_volume_gb
  type              = "gp3"
  encrypted         = true

  tags = { Name = "${var.name}-postgres" }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_volume_attachment" "postgres" {
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.postgres.id
  instance_id = aws_instance.this.id
}

# A public IPv4 address costs about $3.65/month whether or not it is attached.
resource "aws_eip" "this" {
  instance = aws_instance.this.id
  domain   = "vpc"
}

output "public_ip" { value = aws_eip.this.public_ip }
output "instance_id" { value = aws_instance.this.id }
