# VPN Configuration for Monthly Batch Synchronization

# Customer Gateway (On-premise VPN Router)
resource "aws_customer_gateway" "onprem" {
  bgp_asn    = var.customer_gateway_bgp_asn
  ip_address = var.customer_gateway_ip
  type       = "ipsec.1"

  tags = {
    Name = "${var.project_name}-customer-gateway"
  }
}

# Virtual Private Gateway
resource "aws_vpn_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${var.project_name}-vpn-gateway"
  }
}

# VPN Gateway Attachment
resource "aws_vpn_gateway_attachment" "main" {
  vpc_id         = aws_vpc.main.id
  vpn_gateway_id = aws_vpn_gateway.main.id
}

# VPN Connection (IPsec)
resource "aws_vpn_connection" "main" {
  vpn_gateway_id      = aws_vpn_gateway.main.id
  customer_gateway_id = aws_customer_gateway.onprem.id
  type                = "ipsec.1"
  static_routes_only  = true

  tags = {
    Name = "${var.project_name}-vpn-connection"
  }
}

# Static Route for NAS Network (example: 192.168.1.0/24)
resource "aws_vpn_connection_route" "nas_network" {
  destination_cidr_block = "192.168.1.0/24"
  vpn_connection_id      = aws_vpn_connection.main.id
}

# VPN Gateway Route Propagation
resource "aws_vpn_gateway_route_propagation" "private" {
  vpn_gateway_id = aws_vpn_gateway.main.id
  route_table_id = aws_route_table.private.id
}

# CloudWatch Alarm for VPN Connection Status
resource "aws_cloudwatch_metric_alarm" "vpn_connection_status" {
  alarm_name          = "${var.project_name}-vpn-connection-status"
  alarm_description   = "VPN connection status alarm"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  metric_name         = "TunnelState"
  namespace           = "AWS/VPN"
  period              = 300
  statistic           = "Maximum"
  threshold           = 1
  treat_missing_data  = "breaching"

  dimensions = {
    VpnId = aws_vpn_connection.main.id
  }

  alarm_actions = [aws_sns_topic.batch_notifications.arn]

  tags = {
    Name = "${var.project_name}-vpn-alarm"
  }
}

# Output VPN Configuration Details (for on-premise router setup)
output "vpn_tunnel1_address" {
  description = "VPN Tunnel 1 Address"
  value       = aws_vpn_connection.main.tunnel1_address
  sensitive   = true
}

output "vpn_tunnel1_preshared_key" {
  description = "VPN Tunnel 1 Pre-Shared Key"
  value       = aws_vpn_connection.main.tunnel1_preshared_key
  sensitive   = true
}

output "vpn_tunnel2_address" {
  description = "VPN Tunnel 2 Address"
  value       = aws_vpn_connection.main.tunnel2_address
  sensitive   = true
}

output "vpn_tunnel2_preshared_key" {
  description = "VPN Tunnel 2 Pre-Shared Key"
  value       = aws_vpn_connection.main.tunnel2_preshared_key
  sensitive   = true
}
