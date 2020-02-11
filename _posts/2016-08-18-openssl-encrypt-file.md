---
layout: post
title:  "Как зашифровать файл с помощью OpenSSL используя чужой публичный ключ"
date:   2016-08-18 00:18:59 +0300
categories: [Безопасность]
tags: [openssl]
comments: true
---


> Это перевод статьи [How to encrypt a big file using OpenSSL and someone's public key][1],
> которую написал **Alexei Czeskis**.

#### Ситуация

У вас есть чей-то публичный ключ и вы хотите отправить ему файл безопасно.

#### Можете безопасно звонить, писать в чате или отправить файлы по электронной почте?

Вы можете свободно отправлять файлы, если ваш чат с собеседником работает через [OTR][2] или ваша
электронная почта [шифруется][3]. Это будет быстрее. Вы можете согласовать симметричный ключ и использовать
его для [шифрования файлов][4].

***Если вы не можете (или не хотите) так общаться с собеседником, то используйте инструкцию ниже.***

#### Шаг 1: получите публичный ключ

Собеседник должен отправить вам свой публичный ключ в формате **.pem**. Если у него есть RSA-ключ
(например, он использует его для SSH), то он может получить его так:

```
cd ~/.ssh
openssl rsa -in id_rsa -outform pem > id_rsa.pem
openssl rsa -in id_rsa -pubout -outform pem > id_rsa.pub.pem
```

Попросите его отправить вам файл **id_rsa.pub.pem**.

#### Шаг 2: генерация 256 битного (32 байта) рандомного ключа

```
openssl rand -base64 32 > key.bin
```

#### Шаг 3: шифрование ключа

```
openssl rsautl -encrypt -inkey id_rsa.pub.pem -pubin -in key.bin -out key.bin.enc
```

#### Шаг 4: собственно, шифрование большого файла

```
openssl enc -aes-256-cbc -salt -in SECRET_FILE -out SECRET_FILE.enc -pass file:./key.bin
```

#### Шаг 5: отправка и расшифровка файла

Отправьте **.enc** файлы собеседнику и попросите расшифровать файл следующим образом.

```
openssl rsautl -decrypt -inkey id_rsa.pem -in key.bin.enc -out key.bin
openssl enc -d -aes-256-cbc -in SECRET_FILE.enc -out SECRET_FILE -pass file:./key.bin
```

#### Примечания

Вы должны **всегда** проверять хэш файла с получателем или подписывать его вашим закрытым ключом, чтобы другой человек знал, что этот файл пришел действительно от вас.

Если есть [человек посередине][5], то он/она может заменить открытый ключ вашего собеседника на его/ее собственный
и тогда вам кранты. Всегда проверяйте открытый ключ другого человека (проверьте хэш и читайте его друг другу
по телефону).

[1]: http://www.czeskis.com/random/openssl-encrypt-file.html
[2]: https://otr.cypherpunks.ca/
[3]: https://www.gnupg.org/documentation/howtos.en.html
[4]: https://www.madboa.com/geek/openssl/#encrypt-simple
[5]: https://ru.wikipedia.org/wiki/%D0%90%D1%82%D0%B0%D0%BA%D0%B0_%D0%BF%D0%BE%D1%81%D1%80%D0%B5%D0%B4%D0%BD%D0%B8%D0%BA%D0%B0
