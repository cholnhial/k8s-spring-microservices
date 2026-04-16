package dev.chol.shopnow.cart_service.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.serializer.GenericToStringSerializer;
import org.springframework.data.redis.serializer.StringRedisSerializer;

@Configuration
public class RedisConfig {

    @Bean
    public RedisTemplate<String, Integer> redisTemplate(RedisConnectionFactory factory) {
        RedisTemplate<String, Integer> template = new RedisTemplate<>();
        StringRedisSerializer stringSerializer = new StringRedisSerializer();
        GenericToStringSerializer<Integer> integerSerializer =
                new GenericToStringSerializer<>(Integer.class);

        template.setConnectionFactory(factory);
        template.setKeySerializer(stringSerializer);
        template.setHashKeySerializer(stringSerializer);
        template.setValueSerializer(integerSerializer);
        template.setHashValueSerializer(integerSerializer);
        template.afterPropertiesSet();
        return template;
    }
}
