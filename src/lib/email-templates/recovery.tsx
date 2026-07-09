import * as React from 'react'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Text,
} from '@react-email/components'

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({
  siteName,
  confirmationUrl,
}: RecoveryEmailProps) => (
  <Html lang="pt-BR" dir="ltr">
    <Head />
    <Preview>Redefina sua senha no {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Redefina sua senha</Heading>
        <Text style={text}>
          Recebemos uma solicitação para redefinir a senha da sua conta no {siteName}.
          Clique no botão abaixo para escolher uma nova senha.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Redefinir senha
        </Button>
        <Text style={linkText}>
          Se o botão não abrir, copie e cole este link no navegador:{' '}
          <Link href={confirmationUrl} style={link}>
            {confirmationUrl}
          </Link>
        </Text>
        <Text style={footer}>
          Se você não solicitou a redefinição de senha, ignore este e-mail.
          Sua senha não será alterada.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default RecoveryEmail

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '20px 25px' }
const h1 = {
  fontSize: '22px',
  fontWeight: 'bold' as const,
  color: '#000000',
  margin: '0 0 20px',
}
const text = {
  fontSize: '14px',
  color: '#55575d',
  lineHeight: '1.5',
  margin: '0 0 25px',
}
const linkText = {
  fontSize: '13px',
  color: '#55575d',
  lineHeight: '1.5',
  margin: '22px 0 0',
}
const link = { color: '#0f172a', textDecoration: 'underline', wordBreak: 'break-all' as const }
const button = {
  backgroundColor: '#0f172a',
  color: '#ffffff',
  fontSize: '14px',
  borderRadius: '8px',
  padding: '12px 20px',
  textDecoration: 'none',
}
const footer = { fontSize: '12px', color: '#999999', margin: '30px 0 0' }
