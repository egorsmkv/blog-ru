---
layout: post
title: "Высокая доступность MySQL с помощью HAProxy, Consul и Orchestrator"
date: 2020-02-21 00:00:00 +0300
categories: [Базы данных]
tags: [mysql, HA, consul, haproxy]
comments: true
---


> Это перевод статьи [MySQL high availability with HAProxy, Consul and Orchestrator][1],
> которую написал **Ivan Groenewold**.

#### Введение

В этом посте мы исследуем один подход для достижения высокой доступности MySQL с помощью HAProxy, Consul и Orchestrator.

Для начала, давайте кратко пройдёмся по каждой части пазла:

- **HAProxy** обычно установлен на серверах приложения или на промежуточном слое соединения и отвечает за подключение приложения к подходящему бекенду (чтение или запись). Самый популярный вид деплоймента, который я видел: разделить порты для записи (которые направлены на мастер-ноду) и для чтения (которые подключены через балансировщик нагрузки к пулу слейв-нод).
- Роль **Orchestrator**'a заключается в мониторинге топологии и в автоматическом восстановлении, если это требуется. Ключевая часть в том, как мы можем сделать так, чтобы HAProxy был осведомлен о том, было ли изменение топологии или нет, а ответ заключается в Consul'е (и Consul Template).
- **Consul** должен сообщить адрес новой мастер-ноды, который передаст **Orchestrator**. Используя Consul Template мы сможем потом передать этот адрес в **HAProxy**.


#### Доказательство концепции

Для этого я установил 3 тестовых сервера, на каждом из которых запущен MySQL и Consul: mysql1, mysql2 и mysql3.
На сервере mysql3 я также установил HAProxy, Orchestrator и Consul Template.

##### Установка Consul

1. Установите Consul на mysql1, mysql2 и mysql3:

```
$ sudo yum -y install unzip 
$ sudo useradd consul
$ sudo mkdir -p /opt/consul 
$ sudo touch /var/log/consul.log 
$ cd /opt/consul
$ sudo wget https://releases.hashicorp.com/consul/1.0.7/consul_1.0.7_linux_amd64.zip
$ sudo unzip consul_1.0.7_linux_amd64.zip
$ sudo ln -s /opt/consul/consul /usr/local/bin/consul
$ sudo chown consul:consul -R /opt/consul* /var/log/consul.log
```

2. Установите Consul-кластер с одной нодой. Я выбрал mysql3:

```
$ sudo vi /etc/consul.conf.json
{
  "datacenter": "dc1",
  "data_dir": "/opt/consul/",
  "log_level": "INFO",
  "node_name": "mysql3",
  "server": true,
  "ui": true,
  "bootstrap": true,
  "client_addr": "0.0.0.0",
  "advertise_addr": "192.168.56.102"  
}
$ sudo su - consul -c 'consul agent -config-file=/etc/consul.conf.json -config-dir=/etc/consul.d > /var/log/consul.log &'
``` 

3. Запустите Consul на mysql1 и сделайте так, чтобы он присоединился к кластеру:

```
$ sudo vi /etc/consul.conf.json
{
  "datacenter": "dc1",
  "data_dir": "/opt/consul/",
  "log_level": "INFO",
  "node_name": "mysql1",  
  "server": true,
  "ui": true,
  "bootstrap": false,   
  "client_addr": "0.0.0.0",
  "advertise_addr": "192.168.56.100"  
}

$ sudo su - consul -c 'consul agent -config-file=/etc/consul.conf.json -config-dir=/etc/consul.d > /var/log/consul.log &'
$ consul join 192.168.56.102
```

4. Запустите Consul на mysql2 и сделайте так, чтобы он присоединился к кластеру:

```
$ sudo vi /etc/consul.conf.json
{
  "datacenter": "dc1",
  "data_dir": "/opt/consul/",
  "log_level": "INFO",
  "node_name": "mysql2", 
  "server": true,
  "ui": true,
  "bootstrap": false,   
  "client_addr": "0.0.0.0",
  "advertise_addr": "192.168.56.101"
}

$ sudo su - consul -c 'consul agent -config-file=/etc/consul.conf.json -config-dir=/etc/consul.d > /var/log/consul.log &'
$ consul join 192.168.56.102
```

На этом этапе у нас есть работающий Consul-кластер состоящий из 3-х нод. Мы можем протестировать запись пары ключ/значение и получить её обратно:

```
$ consul kv put foo bar
Success! Data written to: foo
$ consul kv get foo
bar
```

##### Настройка Orchestrator'a, чтобы он писал в Consul

К счастью, [Orchestrator имеет встроенную поддержку для Consul'a][1], поэтому мы потратим немного времени на это. Единственное предостережение: нам нужно чтобы Orchestrator заполнил значения в Consul'e, поэтому нужно вручную вызвать orchestrator-client. Это из-за того, что Orchestrator будет только записывать значения каждый раз, когда произойдут изменения о мастер-ноде.

1. Настройте Orchestrator на запись в Consul'e на каждое изменение о мастер-ноде. Добавьте следующие строки в настройки Orchestrator'а:

```
$ vi /etc/orchestrator.conf.json
  "KVClusterMasterPrefix": "mysql/master",
  "ConsulAddress": "127.0.0.1:8500",
```

2. Перезапустите Orchestrator:

```
$ service orchestrator restart
```

3. Заполните вручную текущее значение о мастер-ноде:

```
$ orchestrator-client -c submit-masters-to-kv-stores
```

4. Проверьте сохраненные значения через консоль:

```
$ consul kv get mysql/master/testcluster
mysql1:3306
```

##### Использование Consul Template для управления HAProxy

Так как HAProxy у нас запущен на mysql3, то нам нужно установить Consul Template на этот сервер для управления настройками HAProxy. Идея в том, чтобы настроить Consul Template для динамического обновления файла шаблона настроек HAProxy и перезапустить HAProxy используя изменённый файл настроек.

Для HAProxy я устанавливаю два разных пула: мастер-нода доступна через порт 3307, а слейв-ноды через порт 3308.

1. Установите Consul Template на mysql3:

```
$ mkdir /opt/consul-template
$ cd /opt/consul-template
$ sudo wget https://releases.hashicorp.com/consul-template/0.19.4/consul-template_0.19.4_linux_amd64.zip
$ sudo unzip consul-template_0.19.4_linux_amd64.zip
$ sudo ln -s /opt/consul-template/consul-template /usr/local/bin/consul-template
```

2. Создайте шаблон для настроек HAProxy:

```
$ vi /opt/consul-template/templates/haproxy.ctmpl

global
log 127.0.0.1 local0
log 127.0.0.1 local1 notice
maxconn 4096
chroot /usr/share/haproxy
user haproxy
group haproxy
daemon

defaults
log global
mode http
option tcplog
option dontlognull
retries 3
option redispatch
maxconn 2000
contimeout 5000
clitimeout 50000
srvtimeout 50000

frontend writer-front
bind *:3307
mode tcp
default_backend writer-back

frontend stats-front
bind *:80
mode http
default_backend stats-back

frontend reader-front
bind *:3308
mode tcp
default_backend reader-back

backend writer-back
mode tcp
option httpchk
server master {{key "mysql/master/testcluster"}} check port 9200 inter 12000 rise 3 fall 3

backend stats-back
mode http
balance roundrobin
stats uri /haproxy/stats
stats auth user:pass

backend reader-back
mode tcp
balance leastconn
option httpchk
server slave1 192.168.56.101:3306 check port 9200 inter 12000 rise 3 fall 3
server slave2 192.168.56.102:3306 check port 9200 inter 12000 rise 3 fall 3
server master 192.168.56.100:3306 check port 9200 inter 12000 rise 3 fall 3
```

3. Создайте файл настроек Consul Template:

```
$ vi /opt/consul-template/config/consul-template.cfg

consul {
  auth {
    enabled = false
  }

  address = "127.0.0.1:8500"

  retry {
    enabled = true
    attempts = 12
    backoff = "250ms"
    max_backoff = "1m"
  }

  ssl {
    enabled = false
  }
}

reload_signal = "SIGHUP"
kill_signal = "SIGINT"
max_stale = "10m"
log_level = "info"

wait {
  min = "5s"
  max = "10s"
}

template {
  source = "/opt/consul-template/templates/haproxy.ctmpl"
  destination = "/etc/haproxy/haproxy.cfg"
  command = "sudo service haproxy reload || true"
  command_timeout = "60s"
  perms = 0600
  backup = true 
  wait = "2s:6s"
}
```

4. Дайте sudo-права для Consul Template, чтобы он смог перезапускать HAProxy:

```
$ sudo vi /etc/sudoers

consul ALL=(root) NOPASSWD:/usr/bin/lsof, ...,/sbin/service haproxy reload
```

5. Запустите consul-template:

```
$ nohup /usr/local/bin/consul-template -config=/opt/consul-template/config/consul-template.cfg > /var/log/consul-template/consul-template.log 2>&1 &
```

Итак, это всё, что нам нужно. Следующий шаг - изменить адрес мастер-ноды (например, через Orchestrator GUI) и увидеть изменения:

```
[root@mysql3 config]$ tail -f /var/log/consul-template/consul-template.log
2018/04/17 12:56:25.863912 [INFO] (runner) rendered "/opt/consul-template/templates/haproxy.ctmpl" => "/etc/haproxy/haproxy.cfg"
2018/04/17 12:56:25.864024 [INFO] (runner) executing command "sudo service haproxy reload || true" from "/opt/consul-template/templates/haproxy.ctmpl" => "/etc/haproxy/haproxy.cfg"
2018/04/17 12:56:25.864078 [INFO] (child) spawning: sudo service haproxy reload
Redirecting to /bin/systemctl reload  haproxy.service
```

Что произошло? Orchestrator обновил ключ/значение в Consul'e и Consul Template обнаружил это изменение и в свою очередь обновил файл настроек HAProxy, после этого перезапустил HAProxy.

#### Заключение

HAProxy все еще широко используется как прокcи/балансировщик нагрузки для MySQL, поэтому красиво иметь возможность сочетать его с Orchestrator'ом и Consul'ом, чтобы собрать решение для высокой доступности.

Хотя это жизнеспособная альтернатива, но для нового деплоймента я обычно рекомендую использовать ProxySQL.
Например, у вас есть преимущество [изящное переключение (graceful switchover) без возврата каких-либо ошибок в приложение][3].
Установка также немного проще, так как меньше движущихся частей в ProxySQL Cluster (можно избавиться от Consul'a). Наконец, наличие прокси-сервера для SQL открывает более интересные возможности, такие как раздение чтения/записи и зеркалирование запросов.

[1]: https://blog.pythian.com/mysql-high-availability-with-haproxy-consul-and-orchestrator/
[2]: https://github.com/openark/orchestrator/blob/master/docs/configuration-kv.md
[3]: https://blog.pythian.com/graceful-master-switchover-proxysql-orchestrator/
